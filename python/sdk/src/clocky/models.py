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
    nextCursor: int | None = None


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
