from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Pydantic v2 recursively expands aliases nested in model fields. Keep the
# public JSON aliases broad at the validation layer; wire parsing remains
# strict in the TypeScript SDK protocol and Python callers still receive plain
# JSON-compatible dictionaries/lists.
JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = Any
JsonObject: TypeAlias = dict[str, Any]


@dataclass(slots=True)
class Notification:
    method: str
    payload: JsonObject


@dataclass(slots=True)
class IncomingRequest:
    id: str | int
    method: str
    payload: JsonObject


class ServerInfo(BaseModel):
    name: str | None = None
    version: str | None = None


class InitializeResponse(BaseModel):
    serverInfo: ServerInfo | None = None


class TeamCreateResponse(BaseModel):
    """Wire receipt for creating a local product Team."""

    model_config = ConfigDict(extra="forbid", strict=True)

    teamId: Annotated[str, Field(min_length=1)]
    coordinatorSessionId: Annotated[str, Field(min_length=1)]
    envelopeId: Annotated[str, Field(min_length=1)]


class TeamResumeResponse(BaseModel):
    """Wire response for a Team resume accepted from the authenticated connection."""

    model_config = ConfigDict(extra="forbid", strict=True)

    teamId: Annotated[str, Field(min_length=1)]
    coordinatorSessionId: Annotated[str, Field(min_length=1)]


class TeamResumeRequest(BaseModel):
    """Strict actor-free wire request for one cursor-fenced Team resume."""

    model_config = ConfigDict(extra="forbid", strict=True)

    teamId: Annotated[str, Field(min_length=1)]
    expectedCursor: Annotated[int, Field(ge=0)]


class TeamWaitFinalResponse(BaseModel):
    """Wire receipt for one settled explicit Team final."""

    model_config = ConfigDict(extra="forbid", strict=True)

    teamId: Annotated[str, Field(min_length=1)]
    channelId: Annotated[str, Field(min_length=1)]
    envelopeId: Annotated[str, Field(min_length=1)]
    text: Annotated[str, Field(min_length=1)]


class TeamCancelResponse(BaseModel):
    """Durable phase after cancelling an SDK-tracked runtime-owned TeamRun."""

    model_config = ConfigDict(extra="forbid", strict=True)

    phase: Literal["provisioning", "active", "quiescing", "stalled", "completed", "failed", "cancelled"]


class TeamArchiveResponse(BaseModel):
    """Wire response after the same SDK server archives its retained terminal Team."""

    model_config = ConfigDict(extra="forbid", strict=True)

    teamId: Annotated[str, Field(min_length=1)]
    archivedAt: Annotated[int, Field(ge=0)]


class TeamListResponse(BaseModel):
    """Bounded durable Team summary page returned by the runtime."""

    model_config = ConfigDict(extra="forbid", strict=True)

    items: list[JsonObject]
    scanned: int
    nextCursor: str | None = None


class TeamMemberSessionActivation(BaseModel):
    """Exact published activation identity and current recorded reachability."""

    model_config = ConfigDict(extra="forbid", strict=True)

    id: Annotated[str, Field(min_length=1)]
    teamId: Annotated[str, Field(min_length=1)]
    participantId: Annotated[str, Field(min_length=1)]
    status: Literal["starting", "idle", "running", "stopping", "offline"]


class TeamMemberSessionBinding(BaseModel):
    """Member transcript reference without supervisor configuration or epoch history."""

    model_config = ConfigDict(extra="forbid", strict=True)

    activation: TeamMemberSessionActivation
    sessionId: Annotated[str, Field(min_length=1)]
    provider: Annotated[str, Field(min_length=1)]


class TeamMemberSessionResponse(BaseModel):
    """Published member Session binding without activation side effects."""

    model_config = ConfigDict(extra="forbid", strict=True)

    binding: TeamMemberSessionBinding


_TeamReadId: TypeAlias = Annotated[str, Field(min_length=1)]
_TeamReadCount: TypeAlias = Annotated[int, Field(ge=0, le=9007199254740991)]


class TeamSummaryText(BaseModel):
    """Display prefix with explicit truncation, never a replacement durable value."""

    model_config = ConfigDict(extra="forbid", strict=True)
    text: str
    truncated: bool


class _TaskInspectionIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    teamId: _TeamReadId
    taskId: _TeamReadId
    teamCursor: _TeamReadCount
    revision: Annotated[int, Field(ge=1, le=9007199254740991)]


class TeamTaskRecordInspection(_TaskInspectionIdentity):
    """Complete current task fields with separately counted histories."""
    section: Literal["record"]
    task: JsonObject
    history: dict[Literal["attempts", "reviews"], _TeamReadCount]

    @model_validator(mode="after")
    def validate_record(self) -> TeamTaskRecordInspection:
        if (self.task.get("id") != self.taskId or self.task.get("teamId") != self.teamId
                or type(self.task.get("revision")) is not int or self.task["revision"] != self.revision):
            raise ValueError("Task record does not match its inspection identity and revision")
        if "attemptHistory" in self.task or "reviewHistory" in self.task or set(self.history) != {"attempts", "reviews"}:
            raise ValueError("Task record must omit history arrays and provide both history counts")
        execution = self.task.get("execution")
        count = self.task.get("attemptCount")
        if not isinstance(execution, dict) or execution.get("kind") not in ("participant", "child-team") or type(count) is not int:
            raise ValueError("Task record has no valid execution or attempt count")
        if execution["kind"] == "participant":
            if self.history["attempts"] + (1 if "lease" in self.task else 0) != count or self.history["reviews"] > self.history["attempts"]:
                raise ValueError("Task inspection history counts are inconsistent")
        elif self.history["attempts"] != 0 or self.history["reviews"] != 0:
            raise ValueError("Child task inspection cannot contain Participant attempt history")
        return self


class TeamTaskHistoryInspection(_TaskInspectionIdentity):
    """One bounded, revision-pinned immutable task history window."""
    section: Literal["attempts", "reviews"]
    startCursor: Annotated[int, Field(ge=-1, le=9007199254740991)]
    total: _TeamReadCount
    scanned: _TeamReadCount
    nextCursor: _TeamReadCount | None = None
    items: list[JsonObject]

    @model_validator(mode="after")
    def validate_history(self) -> TeamTaskHistoryInspection:
        count = len(self.items)
        if count > max(0, self.total - self.startCursor - 1) or not count <= self.scanned <= count + 1:
            raise ValueError("Task history accounting is inconsistent")
        if self.nextCursor is not None:
            if not count or self.nextCursor != self.startCursor + count or self.nextCursor >= self.total - 1:
                raise ValueError("Task history continuation is inconsistent")
        elif self.startCursor + count < self.total - 1:
            raise ValueError("Task history omits unread rows without continuation")
        identities = [row.get("id" if self.section == "attempts" else "attemptId") for row in self.items]
        if any(not isinstance(identity, str) or not identity for identity in identities) or len(set(identities)) != count:
            raise ValueError("Task history has missing or repeated attempt identities")
        if self.section == "attempts" and any(row.get("teamId") != self.teamId or row.get("taskId") != self.taskId
                or type(row.get("ordinal")) is not int or row["ordinal"] != self.startCursor + index + 2 for index, row in enumerate(self.items)):
            raise ValueError("Attempt history belongs to a different task or ordinal")
        return self


class TeamTaskInspectResponse(BaseModel):
    """Task inspection response; task bodies retain the SDK's JSON task representation."""
    model_config = ConfigDict(extra="forbid", strict=True)
    inspection: Annotated[TeamTaskRecordInspection | TeamTaskHistoryInspection, Field(discriminator="section")]


class TeamTaskSummary(BaseModel):
    """Task list metadata without instructions, attempt records or result bodies."""

    model_config = ConfigDict(extra="forbid", strict=True)
    id: _TeamReadId
    teamId: _TeamReadId
    revision: Annotated[int, Field(ge=1, le=9007199254740991)]
    phase: Literal["pending", "assigned", "running", "review", "completed", "failed", "cancelled", "deleted"]
    subject: TeamSummaryText
    executionKind: Literal["participant", "child-team"]
    ownerId: _TeamReadId | None = None
    childTeamId: _TeamReadId | None = None
    workflowPlanId: _TeamReadId | None = None
    priority: Annotated[int, Field(ge=-9007199254740991, le=9007199254740991)]
    attemptCount: _TeamReadCount
    maxAttempts: Annotated[int, Field(ge=1, le=9007199254740991)]
    dependencyCount: _TeamReadCount
    reviewCount: _TeamReadCount
    hasLease: bool
    cancellationRequested: bool


class TeamMemberSummary(BaseModel):
    """Member display metadata without grants and provider configuration."""

    model_config = ConfigDict(extra="forbid", strict=True)
    id: _TeamReadId
    teamId: _TeamReadId
    kind: Literal["human", "local-agent", "remote-agent", "service"]
    phase: Literal["invited", "provisioning", "active", "left", "failed"]
    displayName: TeamSummaryText
    role: Annotated[str, Field(min_length=1)]
    capabilityCount: _TeamReadCount


class TeamWorkflowSummary(BaseModel):
    """Workflow metadata without DAG templates or result payloads."""

    model_config = ConfigDict(extra="forbid", strict=True)
    id: _TeamReadId
    teamId: _TeamReadId
    revision: Annotated[int, Field(ge=1, le=9007199254740991)]
    phase: Literal["compiling", "ready", "completed", "failed", "cancelled"]
    name: TeamSummaryText
    taskCount: _TeamReadCount
    boundTaskCount: _TeamReadCount
    channelId: _TeamReadId | None = None


class _TeamBrowseMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    teamId: _TeamReadId
    teamCursor: _TeamReadCount
    total: _TeamReadCount
    scanned: _TeamReadCount
    nextCursor: _TeamReadCount | None = None


class TeamTaskBrowsePage(_TeamBrowseMetadata):
    """Provider-order task summary page."""
    kind: Literal["tasks"]
    items: list[TeamTaskSummary]


class TeamMemberBrowsePage(_TeamBrowseMetadata):
    """Provider-order member summary page."""
    kind: Literal["members"]
    items: list[TeamMemberSummary]


class TeamWorkflowBrowsePage(_TeamBrowseMetadata):
    """Provider-order workflow summary page."""
    kind: Literal["workflowPlans"]
    items: list[TeamWorkflowSummary]


class TeamBrowseResponse(BaseModel):
    """Strict summary response retaining the exact collection and Team identities."""

    model_config = ConfigDict(extra="forbid", strict=True)
    page: Annotated[TeamTaskBrowsePage | TeamMemberBrowsePage | TeamWorkflowBrowsePage, Field(discriminator="kind")]

    @model_validator(mode="after")
    def validate_page(self) -> TeamBrowseResponse:
        page = self.page
        if any(item.teamId != page.teamId for item in page.items):
            raise ValueError("Browse rows must belong to the selected Team")
        if len({item.id for item in page.items}) != len(page.items):
            raise ValueError("Browse page repeats an identity")
        if len(page.items) > page.scanned or page.scanned > page.total:
            raise ValueError("Browse scan accounting is inconsistent")
        if page.nextCursor is not None and page.nextCursor >= page.total - 1:
            raise ValueError("Browse continuation must leave an unread row")
        return self


class TeamMemberInspectionRecord(BaseModel):
    """Exact non-secret member identity and placement metadata."""
    model_config = ConfigDict(extra="forbid", strict=True)
    id: _TeamReadId
    teamId: _TeamReadId
    kind: Literal["human", "local-agent", "remote-agent", "service"]
    phase: Literal["invited", "provisioning", "active", "left", "failed"]
    displayName: _TeamReadId
    role: _TeamReadId
    provider: _TeamReadId | None = None
    preset: _TeamReadId | None = None
    model: _TeamReadId | None = None
    authScheme: _TeamReadId | None = None


class TeamMemberInspection(BaseModel):
    """One capability window pinned to the inspected Team cursor."""
    model_config = ConfigDict(extra="forbid", strict=True)
    record: TeamMemberInspectionRecord
    teamCursor: _TeamReadCount
    startCursor: Annotated[int, Field(ge=-1)]
    total: _TeamReadCount
    scanned: _TeamReadCount
    items: list[_TeamReadId]
    nextCursor: _TeamReadCount | None = None

    @model_validator(mode="after")
    def validate_window(self) -> TeamMemberInspection:
        if not len(self.items) <= self.scanned <= len(self.items) + 1 or len(self.items) > max(0, self.total - self.startCursor - 1):
            raise ValueError("Member inspection page accounting is inconsistent")
        if self.nextCursor is not None and (not self.items or self.nextCursor != self.startCursor + len(self.items) or self.nextCursor >= self.total - 1):
            raise ValueError("Member inspection continuation is inconsistent")
        return self


class TeamMemberInspectResponse(BaseModel):
    """Member detail without complete Team or participant history."""
    model_config = ConfigDict(extra="forbid", strict=True)
    detail: TeamMemberInspection


class TeamSelectionResponse(BaseModel):
    """Bounded Team identity, coordinator binding and collection counts."""

    model_config = ConfigDict(extra="forbid", strict=True)

    selection: JsonObject


class TeamGetResponse(BaseModel):
    """Complete durable Team state returned by the runtime."""

    model_config = ConfigDict(extra="forbid", strict=True)

    state: JsonObject


class TeamGoalUpdateInput(BaseModel):
    """Actor-free replacement fields for one Team objective."""

    model_config = ConfigDict(extra="forbid", strict=True)

    expectedRevision: Annotated[int, Field(ge=1)]
    objective: Annotated[str, Field(min_length=1)] | None = None
    budgets: JsonObject | None = None

    @model_validator(mode="after")
    def requires_replacement(self) -> "TeamGoalUpdateInput":
        if self.objective is None and self.budgets is None:
            raise ValueError("Team goal update requires objective or budgets")
        return self


class TeamGoalUpdateRequest(TeamGoalUpdateInput):
    """Strict actor-free wire request for one Team objective update."""

    teamId: Annotated[str, Field(min_length=1)]


class TeamGoalUpdateResponse(BaseModel):
    """Durable Team state returned after one Team objective update."""

    model_config = ConfigDict(extra="forbid", strict=True)

    state: JsonObject


class TeamGoalBlocker(BaseModel):
    """Machine-routable explanation retained while one Team objective is blocked."""

    model_config = ConfigDict(extra="forbid", strict=True)

    code: Annotated[str, Field(min_length=1)]
    message: Annotated[str, Field(min_length=1)]


class TeamGoalTransitionInput(BaseModel):
    """Actor-free lifecycle transition fields for one Team objective."""

    model_config = ConfigDict(extra="forbid", strict=True)

    expectedRevision: Annotated[int, Field(ge=1)]
    phase: Literal["active", "paused", "blocked", "complete"]
    blocker: TeamGoalBlocker | None = None

    @model_validator(mode="after")
    def requires_matching_blocker(self) -> "TeamGoalTransitionInput":
        if (self.phase == "blocked") != (self.blocker is not None):
            raise ValueError("Team goal transition blocker must be present exactly while phase is blocked")
        return self


class TeamGoalTransitionRequest(TeamGoalTransitionInput):
    """Strict actor-free wire request for one Team objective lifecycle transition."""

    teamId: Annotated[str, Field(min_length=1)]


class TeamGoalTransitionResponse(BaseModel):
    """Durable Team state returned after one Team objective lifecycle transition."""

    model_config = ConfigDict(extra="forbid", strict=True)

    state: JsonObject


class TeamMemberListResponse(BaseModel):
    """Bounded durable Team participant page."""

    model_config = ConfigDict(extra="forbid", strict=True)

    items: list[JsonObject]
    nextCursor: int | None = None


class TeamTaskListResponse(BaseModel):
    """Bounded durable Team task page."""

    model_config = ConfigDict(extra="forbid", strict=True)

    items: list[JsonObject]
    nextCursor: int | None = None


class TeamWorkflowPlanListResponse(BaseModel):
    """Bounded durable workflow-plan page."""

    model_config = ConfigDict(extra="forbid", strict=True)

    items: list[JsonObject]
    nextCursor: int | None = None


class TeamArtifactListResponse(BaseModel):
    """Bounded visible Team artifact-reference page."""

    model_config = ConfigDict(extra="forbid", strict=True)

    items: list[JsonObject]
    nextCursor: int | None = None


class TeamChannelReadResponse(BaseModel):
    """Bounded channel WAL projection and records."""

    model_config = ConfigDict(extra="forbid", strict=True)

    value: JsonObject


class TeamQuiescenceResponse(BaseModel):
    """Durable quiescence diagnostics for one Team."""

    model_config = ConfigDict(extra="forbid", strict=True)

    value: JsonObject


class TeamLatencyBucket(BaseModel):
    """One cumulative Team latency bucket; null is the positive-infinity bound."""

    model_config = ConfigDict(extra="forbid", strict=True)

    upperBoundMs: Annotated[int, Field(ge=0)] | None
    count: Annotated[int, Field(ge=0)]


class TeamLatencyHistogram(BaseModel):
    """Fixed-boundary cumulative latency histogram from the Team metrics route."""

    model_config = ConfigDict(extra="forbid", strict=True)

    count: Annotated[int, Field(ge=0)]
    sumMs: Annotated[int, Field(ge=0)]
    buckets: list[TeamLatencyBucket]


class TeamMetricsResponse(BaseModel):
    """Process-local Team operational counters and gauges."""

    model_config = ConfigDict(extra="forbid", strict=True)

    activeAdmissions: Annotated[int, Field(ge=0)]
    pendingDeliveries: Annotated[int, Field(ge=0)]
    activeActivations: Annotated[int, Field(ge=0)]
    activeTasks: Annotated[int, Field(ge=0)]
    stalledTeams: Annotated[int, Field(ge=0)]
    replayLag: Annotated[int, Field(ge=0)]
    lastTaskLatencyMs: Annotated[int, Field(ge=0)]
    lastReceiptLatencyMs: Annotated[int, Field(ge=0)]
    taskLatency: TeamLatencyHistogram
    receiptLatency: TeamLatencyHistogram
    workspaceConflicts: Annotated[int, Field(ge=0)]
    teamEvents: Annotated[int, Field(ge=0)]
    channelEvents: Annotated[int, Field(ge=0)]
    policyDenials: Annotated[int, Field(ge=0)]
    adapterFailures: Annotated[int, Field(ge=0)]
    deliveryClaims: Annotated[int, Field(ge=0)]
    taskAssignments: Annotated[int, Field(ge=0)]
    taskRetries: Annotated[int, Field(ge=0)]
    teamCompactions: Annotated[int, Field(ge=0)]
    channelCompactions: Annotated[int, Field(ge=0)]
    checkpointFailures: Annotated[int, Field(ge=0)]
    auditProjectionRepairs: Annotated[int, Field(ge=0)]
    auditProjectionFailures: Annotated[int, Field(ge=0)]
    updatedAt: Annotated[int, Field(ge=0)]


class TeamAuditReadResponse(BaseModel):
    """Bounded Team or channel audit page."""

    model_config = ConfigDict(extra="forbid", strict=True)

    teamId: Annotated[str, Field(min_length=1)]
    channelId: str | None = None
    firstCursor: int | None = None
    items: list[JsonObject]
    nextCursor: int | None = None


class TeamArtifactReadResponse(BaseModel):
    """Verified bytes for one visible durable Team artifact."""

    model_config = ConfigDict(extra="forbid", strict=True)

    artifact: JsonObject
    bytes: Annotated[int, Field(ge=0)]
    data: str


class TeamMemberResponse(BaseModel):
    """Wire response for an authenticated Team member-management request."""

    model_config = ConfigDict(extra="forbid", strict=True)

    value: JsonObject


class TeamInterruptResponse(BaseModel):
    """Wire response for an authenticated Team member-interruption request."""

    model_config = ConfigDict(extra="forbid", strict=True)

    value: JsonObject


class ChannelSummaryCapabilities(BaseModel):
    """Installed extractive summary policies and bounds."""

    model_config = ConfigDict(extra="forbid", strict=True)
    allowedPolicies: list[str]
    maxSourceEnvelopes: Annotated[int, Field(gt=0)]
    maxSourceBytes: Annotated[int, Field(gt=0)]
    maxSummaryBytes: Annotated[int, Field(gt=0)]
    maxHistorySpan: Annotated[int, Field(gt=0)]


class TeamChannelCatalogResponse(BaseModel):
    """Accepting protocol registrations and optional summary capabilities."""

    model_config = ConfigDict(extra="forbid", strict=True)
    adapters: list[JsonObject]
    viewPolicies: list[JsonObject]
    summary: ChannelSummaryCapabilities | None = None


class TeamChannelListResponse(BaseModel):
    """Bounded channel projections and a stable insertion-index continuation."""

    model_config = ConfigDict(extra="forbid", strict=True)

    items: list[JsonObject]
    nextCursor: Annotated[int, Field(ge=0)] | None = None


class ImageAttachmentOriginalDimensions(BaseModel):
    """Image dimensions before normalization reduced the raster."""

    model_config = ConfigDict(extra="forbid", strict=True)
    width: Annotated[int, Field(gt=0)]
    height: Annotated[int, Field(gt=0)]


class ImageAttachmentReference(BaseModel):
    """Durable image reference whose metadata is verified by attachment storage."""

    model_config = ConfigDict(extra="forbid", strict=True)
    attachmentId: Annotated[str, Field(min_length=1)]
    mediaType: Literal["image/png", "image/jpeg", "image/webp", "image/gif"]
    bytes: Annotated[int, Field(gt=0)]
    width: Annotated[int, Field(gt=0)]
    height: Annotated[int, Field(gt=0)]
    name: str | None = None
    originalDimensions: ImageAttachmentOriginalDimensions | None = None


class TeamChannelAttachmentResponse(BaseModel):
    """An Envelope-authorized image reference and its base64-encoded bytes."""

    model_config = ConfigDict(extra="forbid", strict=True)
    attachment: ImageAttachmentReference
    data: Annotated[str, Field(min_length=1)]


class TeamChannelResponse(BaseModel):
    """Wire response for a Team channel route; generic writes require an authenticated Team actor."""

    model_config = ConfigDict(extra="forbid", strict=True)

    value: JsonObject


class TeamTaskResponse(BaseModel):
    """Wire response for a Team task route; generic writes require an authenticated Team actor."""

    model_config = ConfigDict(extra="forbid", strict=True)

    value: JsonObject


@dataclass(frozen=True, slots=True)
class TeamFinalReceipt:
    """Durable human-addressed final returned by a completed Team."""

    team_id: str
    channel_id: str
    envelope_id: str
    text: str


class TeamHumanInboxFinal(BaseModel):
    """Exact principal-owned final content with an independent inbox sequence."""

    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["final"]
    principalId: Annotated[str, Field(min_length=1)]
    recipientId: Annotated[str, Field(min_length=1)]
    teamId: Annotated[str, Field(min_length=1)]
    channelId: Annotated[str, Field(min_length=1)]
    envelopeId: Annotated[str, Field(min_length=1)]
    envelopeSequence: Annotated[int, Field(ge=0)]
    contentFingerprint: Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
    idempotencyKey: Annotated[str, Field(min_length=1)]
    text: Annotated[str, Field(min_length=1)]
    sequence: Annotated[int, Field(ge=0)]


class TeamHumanEnvelope(BaseModel):
    """Strict retained channel Envelope carried by an ordinary inbox delivery."""
    model_config = ConfigDict(extra="forbid", strict=True)
    id: Annotated[str, Field(min_length=1)]
    teamId: Annotated[str, Field(min_length=1)]
    channelId: Annotated[str, Field(min_length=1)]
    senderId: Annotated[str, Field(min_length=1)]
    audience: list[Annotated[str, Field(min_length=1)]] | None
    kind: Annotated[str, Field(min_length=1)]
    payload: JsonObject
    delivery: Literal["context", "turn", "steer"]
    priority: Literal["background", "normal", "urgent"]
    sequence: Annotated[int, Field(ge=0)]
    createdAt: Annotated[int, Field(ge=0)]
    causationId: str | None = None
    correlationId: str | None = None
    taskId: str | None = None
    traceId: str | None = None
    ttlMs: Annotated[int, Field(ge=0)] | None = None


class TeamHumanInboxMessage(BaseModel):
    """Ordinary human channel delivery with its exact source Envelope."""

    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["message"]
    principalId: Annotated[str, Field(min_length=1)]
    recipientId: Annotated[str, Field(min_length=1)]
    teamId: Annotated[str, Field(min_length=1)]
    channelId: Annotated[str, Field(min_length=1)]
    envelopeId: Annotated[str, Field(min_length=1)]
    envelope: TeamHumanEnvelope
    view: JsonObject | None = None
    text: str
    sequence: Annotated[int, Field(ge=0)]

    @model_validator(mode="after")
    def exact_envelope(self):
        """Keep the receipt source distinct from a final and bound to the visible Team/channel."""
        if self.envelope.kind == "final" or any(getattr(self.envelope, key) != value for key, value in (
            ("teamId", self.teamId), ("channelId", self.channelId), ("id", self.envelopeId),
        )):
            raise ValueError("ordinary inbox delivery must preserve its exact non-final Envelope")
        return self


class TeamApprovalAnswer(BaseModel):
    """An explicit one-use approval decision."""
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["approval"]
    outcome: Literal["allowed-once", "rejected"]


class TeamQuestionAnswerItem(BaseModel):
    """One selected or written question response."""
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str
    selected: list[str]
    custom: str | None = None


class TeamQuestionAnswer(BaseModel):
    """Typed question answers checked against the current request by the Host."""
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["question"]
    answers: list[TeamQuestionAnswerItem]


class TeamHumanAcceptedResponse(BaseModel):
    """Exact answer accepted before notifying the original callback."""
    model_config = ConfigDict(extra="forbid", strict=True)
    expectedUpdatedAt: Annotated[int, Field(ge=0)]
    idempotencyKey: Annotated[str, Field(min_length=1, max_length=256)]
    answer: Annotated[TeamApprovalAnswer | TeamQuestionAnswer, Field(discriminator="kind")]
    respondedBy: Annotated[str, Field(min_length=1)]
    acceptedAt: Annotated[int, Field(ge=0)]


class TeamHumanActionView(BaseModel):
    """Durable action provenance, accepted answer and terminal outcome."""
    model_config = ConfigDict(extra="forbid", strict=True)
    id: Annotated[str, Field(min_length=1)]
    teamId: Annotated[str, Field(min_length=1)]
    kind: Literal["approval", "question"]
    phase: Literal["pending", "resolved", "cancelled"]
    sessionId: Annotated[str, Field(min_length=1)]
    participantId: Annotated[str, Field(min_length=1)]
    taskId: str | None = None
    attemptId: str | None = None
    sourceId: Annotated[str, Field(min_length=1)]
    details: JsonObject
    outcome: JsonObject | None = None
    response: TeamHumanAcceptedResponse | None = None
    createdAt: Annotated[int, Field(ge=0)]
    updatedAt: Annotated[int, Field(ge=0)]

    @model_validator(mode="after")
    def valid_lifecycle(self):
        """Reject outcomes and response metadata that contradict the retained request."""
        if self.updatedAt < self.createdAt or (self.phase == "pending") != (self.outcome is None):
            raise ValueError("action lifecycle and outcome disagree")
        if self.attemptId is not None and self.taskId is None:
            raise ValueError("action attempt requires its task")
        if self.response is not None and (self.response.answer.kind != self.kind
            or not self.createdAt <= self.response.expectedUpdatedAt <= self.response.acceptedAt <= self.updatedAt):
            raise ValueError("accepted response has invalid action provenance")
        return self


class TeamHumanInboxAction(BaseModel):
    """One durable approval/question revision addressed to the principal."""

    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["action"]
    principalId: Annotated[str, Field(min_length=1)]
    recipientId: Annotated[str, Field(min_length=1)]
    teamId: Annotated[str, Field(min_length=1)]
    action: TeamHumanActionView
    text: str
    sequence: Annotated[int, Field(ge=0)]

    @model_validator(mode="after")
    def exact_action(self):
        """Keep action ownership and supported kinds explicit at the wire boundary."""
        if self.action.teamId != self.teamId:
            raise ValueError("inbox action must belong to its Team and have a supported kind")
        return self


TeamHumanInboxItem: TypeAlias = Annotated[TeamHumanInboxFinal | TeamHumanInboxMessage | TeamHumanInboxAction, Field(discriminator="kind")]


class TeamHumanInboxPage(BaseModel):
    """Bounded page with a shared durable display position."""

    model_config = ConfigDict(extra="forbid", strict=True)

    items: list[TeamHumanInboxItem]
    displayCursor: Annotated[int, Field(ge=-1)]
    cursor: Annotated[int, Field(ge=-1)]
    nextCursor: Annotated[int, Field(ge=-1)] | None = None


class TeamHumanInboxAcknowledgement(BaseModel):
    """Durable display cursor, independent of channel delivery receipts."""

    model_config = ConfigDict(extra="forbid", strict=True)

    displayCursor: Annotated[int, Field(ge=-1)]


class TeamHumanActionResponseRequest(BaseModel):
    """Actor-free exact request revision, retry identity and typed answer."""
    model_config = ConfigDict(extra="forbid", strict=True)
    teamId: Annotated[str, Field(min_length=1)]
    actionId: Annotated[str, Field(min_length=1)]
    expectedUpdatedAt: Annotated[int, Field(ge=0)]
    idempotencyKey: Annotated[str, Field(min_length=1, max_length=256)]
    answer: Annotated[TeamApprovalAnswer | TeamQuestionAnswer, Field(discriminator="kind")]


class TeamHumanActionResponseResult(BaseModel):
    """Durable answer acceptance or an explicitly unrecoverable continuation."""
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["accepted", "unavailable"]
    action: TeamHumanActionView


class TeamWorkflowTaskRef(BaseModel):
    """Workflow-local identity with an optional admitted task binding."""
    model_config = ConfigDict(extra="forbid", strict=True)
    templateId: Annotated[str, Field(min_length=1)]
    subject: TeamSummaryText
    taskId: Annotated[str, Field(min_length=1)] | None = None


class TeamWorkflowInspectionTask(TeamWorkflowTaskRef):
    """One task and its dependencies, without instructions or result bodies."""
    blockedBy: list[TeamWorkflowTaskRef]


class TeamWorkflowInspectionBounds(BaseModel):
    """Validated execution ceilings of an admitted workflow."""
    model_config = ConfigDict(extra="forbid", strict=True)
    maxTasks: Annotated[int, Field(ge=1)]
    maxParallelism: Annotated[int, Field(ge=1)]
    maxTotalAttempts: Annotated[int, Field(ge=1)]


class TeamWorkflowInspectionReason(BaseModel):
    """Durable failure or cancellation reason."""
    model_config = ConfigDict(extra="forbid", strict=True)
    code: Annotated[str, Field(min_length=1)]
    message: Annotated[str, Field(min_length=1)]


class TeamWorkflowInspectionRecord(BaseModel):
    """Current workflow lifecycle and fixed execution limits."""
    model_config = ConfigDict(extra="forbid", strict=True)
    id: Annotated[str, Field(min_length=1)]
    teamId: Annotated[str, Field(min_length=1)]
    revision: Annotated[int, Field(ge=1)]
    phase: Literal["compiling", "ready", "completed", "failed", "cancelled"]
    name: Annotated[str, Field(min_length=1)]
    bounds: TeamWorkflowInspectionBounds
    failure: TeamWorkflowInspectionReason | None = None
    cancellation: TeamWorkflowInspectionReason | None = None
    resultTaskCount: Annotated[int, Field(ge=0)] | None = None


class TeamWorkflowInspection(BaseModel):
    """One revision-pinned workflow task window."""
    model_config = ConfigDict(extra="forbid", strict=True)
    record: TeamWorkflowInspectionRecord
    teamCursor: Annotated[int, Field(ge=0)]
    startCursor: Annotated[int, Field(ge=-1)]
    items: list[TeamWorkflowInspectionTask]
    total: Annotated[int, Field(ge=0)]
    scanned: Annotated[int, Field(ge=0)]
    nextCursor: Annotated[int, Field(ge=0)] | None = None

    @model_validator(mode="after")
    def valid_window(self):
        """Reject skipped rows, repeated templates and impossible continuation."""
        end = self.startCursor + len(self.items)
        if len(self.items) > max(0, self.total - self.startCursor - 1) or self.scanned < len(self.items):
            raise ValueError("Invalid workflow window accounting")
        if self.nextCursor is not None and (not self.items or self.nextCursor != end or end >= self.total - 1):
            raise ValueError("Invalid workflow continuation")
        if self.nextCursor is None and end < self.total - 1:
            raise ValueError("Workflow window omits continuation")
        for item in self.items:
            if (len({ref.templateId for ref in item.blockedBy}) != len(item.blockedBy)
                    or any(ref.templateId == item.templateId for ref in item.blockedBy)):
                raise ValueError("Invalid workflow dependency references")
        if len({item.templateId for item in self.items}) != len(self.items):
            raise ValueError("Workflow window repeats a task template")
        if self.total > self.record.bounds.maxTasks or (self.record.resultTaskCount or 0) > self.total:
            raise ValueError("Workflow counts exceed their bounds")
        if (self.record.phase == "failed") != (self.record.failure is not None):
            raise ValueError("Workflow failure does not match its phase")
        if self.record.cancellation is not None and self.record.phase != "cancelled":
            raise ValueError("Workflow cancellation does not match its phase")
        if (self.record.phase == "completed" and self.record.resultTaskCount is None
                or self.record.phase in ("compiling", "ready") and self.record.resultTaskCount is not None):
            raise ValueError("Workflow result count does not match its phase")

        return self
