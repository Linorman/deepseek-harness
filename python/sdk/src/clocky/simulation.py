"""Strict Simulation product DTOs; identities and simulated time remain opaque strings."""
from __future__ import annotations

from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Identity = Annotated[str, Field(min_length=1)]
Decimal = Annotated[str, Field(pattern=r"^(0|[1-9][0-9]*)$")]
PositiveDecimal = Annotated[str, Field(pattern=r"^[1-9][0-9]*$")]
Nonnegative = Annotated[int, Field(ge=0)]
ObservationCount = Annotated[int, Field(ge=0, le=9_007_199_254_740_991)]
EntityPhase = Literal["active", "inactive", "terminated"]
DecisionStatus = Literal["open", "submitted", "accepted", "cancelled"]
OperationStatus = Literal["pending", "applied", "rejected", "blocked-authority", "blocked-dependency", "outcome-unknown"]
CheckpointStatus = Literal["in-progress", "failed", "completed"]
Collection = Literal["entities", "decisions", "operations", "checkpoints"]

class SimulationModel(BaseModel):
    """Closed JSON fields prevent native configuration or private bodies from entering public DTOs."""
    model_config = ConfigDict(extra="forbid", strict=True)

class SimulationText(SimulationModel):
    """Bounded display text with explicit truncation."""

    text: str
    truncated: bool


class SimulationModelRoute(SimulationModel):
    """Installed model selection without credentials."""

    provider: Identity
    name: Identity


class SimulationModelReady(SimulationModel):
    """Metadata-resolved route available for explicit confirmation; no inference is performed."""

    status: Literal["ready"]
    model: SimulationModelRoute


class SimulationModelMissing(SimulationModel):
    """Installed template remains visible while no complete default model exists."""

    status: Literal["needs-model"]
    reason: Literal["default-model-missing"]


class SimulationModelUnavailable(SimulationModel):
    """Safe current deployment reason; private provider errors are withheld."""

    status: Literal["unavailable"]
    reason: Literal["provider-unavailable", "metadata-unavailable", "reasoning-unsupported", "execution-unavailable", "template-unavailable"]


SimulationModelReadiness = Annotated[
    SimulationModelReady | SimulationModelMissing | SimulationModelUnavailable, Field(discriminator="status")
]


LimitKey = Literal["maxEntities", "maxResidentActors", "tokensPerModelRequest", "maxTokensPerInterval", "maxTime"]


class SimulationLimits(SimulationModel):
    """Resolved immutable allowances; simulated tick horizons stay canonical decimals."""

    maxEntities: Annotated[int, Field(gt=0)]
    maxResidentActors: Annotated[int, Field(gt=0)]
    tokensPerModelRequest: Annotated[int, Field(gt=0)]
    maxTokensPerInterval: Nonnegative
    maxTime: PositiveDecimal


class SimulationLimitsInput(SimulationModel):
    """Allowlisted optional allowances, bounded by deployment during preflight and creation."""

    maxEntities: Annotated[int, Field(gt=0)] | None = None
    maxResidentActors: Annotated[int, Field(gt=0)] | None = None
    tokensPerModelRequest: Annotated[int, Field(gt=0)] | None = None
    maxTokensPerInterval: Nonnegative | None = None
    maxTime: PositiveDecimal | None = None


class SimulationConfiguration(SimulationModel):
    """Read-only configuration resolution; the shared capacity observation reserves no permit."""

    limits: SimulationLimits
    budgetInterval: PositiveDecimal
    tickUnit: SimulationText
    rulesVersion: SimulationText
    policyVersion: SimulationText
    sharedModelLimit: Annotated[int, Field(gt=0)]


class SimulationTemplateConfiguration(SimulationConfiguration):
    """Installed deployment defaults and the exact editable allowance keys."""

    editable: list[LimitKey]


class SimulationTemplate(SimulationModel):
    """Installed versioned company template with its Host-selected task execution mode."""

    id: Identity
    version: Literal["1"]
    name: SimulationText
    kind: Literal["company-procurement", "task-workflow"]
    readiness: SimulationModelReadiness
    tickUnit: SimulationText
    execution: Literal["cognition-only", "automatic-tasks"]
    cognition: Literal["model", "deterministic"] | None = None
    review: Literal["none", "buyer", "participant"]
    maxStock: PositiveDecimal
    configuration: SimulationTemplateConfiguration | None = None


class SimulationCatalog(SimulationModel):
    """Complete bounded authorized template catalog."""

    items: list[SimulationTemplate]


class SimulationCompanyParameters(SimulationModel):
    """Permitted template values without executable configuration."""

    buyerName: Identity
    supplierName: Identity
    initialStock: PositiveDecimal


class SimulationCreateInput(SimulationModel):
    """Caller-retained durable creation identity; creating a run performs no inference."""

    commandId: Identity
    templateId: Identity
    templateVersion: Literal["1"]
    expectedModel: SimulationModelRoute
    name: Identity
    parameters: SimulationCompanyParameters
    limits: SimulationLimitsInput | None = None


class SimulationPreflightInput(SimulationModel):
    """Creation draft without a command; validation allocates no run or actor."""

    templateId: Identity
    templateVersion: Literal["1"]
    name: Identity
    parameters: SimulationCompanyParameters
    limits: SimulationLimitsInput | None = None


class SimulationPreflightIssue(SimulationModel):
    """Safe field rejection without private provider diagnostics."""

    field: Annotated[str, Field(min_length=1, max_length=256)]
    code: Literal["invalid", "not-allowed", "unavailable", "capacity-unavailable"]
    message: SimulationText


class SimulationPreflightResult(SimulationModel):
    """Current readiness observation; creation independently rechecks before acceptance."""

    status: Literal["ready", "invalid"]
    readiness: SimulationModelReadiness
    configuration: SimulationConfiguration | None = None
    issues: Annotated[list[SimulationPreflightIssue], Field(min_length=1, max_length=32)] | None = None

    @model_validator(mode="after")
    def _outcome(self) -> SimulationPreflightResult:
        if self.status == "ready":
            if self.configuration is None or "issues" in self.model_fields_set or not isinstance(self.readiness, SimulationModelReady):
                raise ValueError("Ready preflight carries only resolved configuration")
        elif self.issues is None or "configuration" in self.model_fields_set:
            raise ValueError("Invalid preflight carries only field issues")
        return self


class SimulationPrepareInput(SimulationModel):
    """Distinct or exact-retried preparation of the original run."""

    runId: Identity
    commandId: Identity


class SimulationRequestInput(SimulationModel):
    """Original command query; absence does not establish failure."""

    commandId: Identity


class SimulationTasksInput(SimulationModel):
    """Bounded exact owned-run task observation without task bodies or actor fields."""

    runId: Identity
    limit: Annotated[int, Field(gt=0)] | None = None
    cursor: Identity | None = None
    expectedRevision: Nonnegative | None = None


class SimulationTaskCancelInput(SimulationModel):
    """Original cancellation intent; null explicitly requires no active attempt lease."""

    runId: Identity
    commandId: Identity
    operationId: Identity
    expectedRevision: Annotated[int, Field(gt=0)]
    expectedAttemptId: Identity | None
    reason: Identity

    @field_validator("commandId")
    @classmethod
    def _command(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("Cancellation command identity must be trimmed")
        return value

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Cancellation requires a nonempty reason")
        return value.strip()


class SimulationTaskCancellationMetadata(SimulationModel):
    """Safe current cancellation progress without the retained original reason."""

    requestedAt: Nonnegative
    target: Literal["pending", "review", "attempt", "delegation"]


class SimulationTaskCancelAction(SimulationModel):
    """Hints remain independent of the revision and attempt checks at native admission."""

    allowed: bool
    reason: Literal["ready", "terminal", "cancellation-pending", "recovery-required", "maintenance-in-progress"]

    @model_validator(mode="after")
    def _validate(self) -> SimulationTaskCancelAction:
        if self.allowed != (self.reason == "ready"):
            raise ValueError("Only ready task cancellation is allowed")
        return self


class SimulationTaskControl(SimulationModel):
    """Canonical run-owned task metadata and exact current cancellation selection."""

    operationId: Identity
    teamId: Identity
    taskId: Identity
    taskRevision: Annotated[int, Field(gt=0)]
    phase: Literal["pending", "assigned", "running", "review", "completed", "failed", "cancelled", "deleted"]
    attemptCount: Nonnegative
    maxAttempts: Annotated[int, Field(gt=0)]
    expectedAttemptId: Identity | None
    cancellation: SimulationTaskCancellationMetadata | None = None
    cancel: SimulationTaskCancelAction


class SimulationTasksPage(SimulationModel):
    """Bounded metadata pinned to retained world and canonical task observations."""

    runId: Identity
    snapshotRevision: Nonnegative
    observedAt: Nonnegative
    total: Nonnegative
    items: list[SimulationTaskControl]
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationTasksPage:
        if self.total < len(self.items):
            raise ValueError("Task total must include its current window")
        return self


class SimulationRequestReceipt(SimulationModel):
    """Immutable accepted or terminal creation/preparation receipt."""

    commandId: Identity
    runId: Identity
    kind: Literal["create", "prepare", "checkpoint", "restore", "review", "retry-operation", "cancel-task"]
    acceptedAt: Nonnegative
    status: Literal["accepted", "completed", "failed"]
    checkpointId: Identity | None = None
    diagnostic: SimulationCheckpointDiagnostic | None = None
    failure: Literal["preparation-required", "recovery-required", "unavailable", "checkpoint-failed", "restore-failed", "review-failed", "retry-operation-failed", "cancel-task-failed"] | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationRequestReceipt:
        if (self.status == "failed") != (self.failure is not None):
            raise ValueError("only failed requests carry a failure category")
        if (self.kind in {"checkpoint", "restore"}) != (self.checkpointId is not None):
            raise ValueError("maintenance receipts require their exact checkpoint identity")
        if self.status == "failed" and self.failure not in {"recovery-required", "unavailable"}:
            expected = {"checkpoint": "checkpoint-failed", "restore": "restore-failed", "review": "review-failed", "retry-operation": "retry-operation-failed", "cancel-task": "cancel-task-failed"}.get(self.kind, "preparation-required")
            if self.failure != expected:
                raise ValueError("failure category does not belong to the original operation kind")
        if self.diagnostic is not None and (self.status != "failed" or self.kind not in {"checkpoint", "restore"}):
            raise ValueError("Only failed checkpoint or restore receipts carry source diagnoses")
        return self


class SimulationRequestResult(SimulationModel):
    """Exact original operation fact or non-authoritative absence."""

    status: Literal["found", "not-found"]
    commandId: Identity | None = None
    request: SimulationRequestReceipt | None = None
    review: SimulationTaskReviewResolveInput | None = None
    retryOperation: SimulationOperationRetryInput | None = None
    cancellation: SimulationTaskCancelInput | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationRequestResult:
        if self.status == "found":
            if self.request is None or self.commandId is not None:
                raise ValueError("found results carry only the original request")
            if (self.request.kind == "review") != (self.review is not None):
                raise ValueError("Only review results carry their original immutable payload")
            if self.review is not None and (self.review.runId != self.request.runId or self.review.commandId != self.request.commandId):
                raise ValueError("Review result input belongs to another original command")
            if (self.request.kind == "retry-operation") != (self.retryOperation is not None):
                raise ValueError("Only operation retry results carry their exact original intent")
            if self.retryOperation is not None and (self.retryOperation.runId != self.request.runId or self.retryOperation.commandId != self.request.commandId):
                raise ValueError("Operation retry input belongs to another original command")
            if (self.request.kind == "cancel-task") != (self.cancellation is not None):
                raise ValueError("Only task cancellation results carry their exact original intent")
            if self.cancellation is not None and (self.cancellation.runId != self.request.runId or self.cancellation.commandId != self.request.commandId):
                raise ValueError("Task cancellation input belongs to another original command")
        elif self.commandId is None or self.request is not None or self.review is not None or self.retryOperation is not None or self.cancellation is not None:
            raise ValueError("absence carries only the original command identity")
        return self


class SimulationListInput(SimulationModel):
    """Bounded directory selection without a provider or physical path."""

    cursor: Identity | None = None
    limit: Annotated[int, Field(gt=0)] | None = None
    search: str | None = None


class SimulationSummary(SimulationModel):
    """Safe registered-run metadata independent of native inspection."""

    id: Identity
    name: SimulationText
    registeredAt: Nonnegative
    observation: Literal["not-observed"]


class SimulationRunPage(SimulationModel):
    """Bounded authorized directory page."""

    items: list[SimulationSummary]
    nextCursor: Identity | None = None


class SimulationInspectInput(SimulationModel):
    """Registered run selection grants no access by itself."""

    runId: Identity


class SimulationWorld(SimulationModel):
    """Administrative observation without world bodies or storage paths."""

    revision: Nonnegative
    phase: Literal["paused", "running", "stalled"]
    time: Decimal
    tickUnit: SimulationText
    owner: Literal["this-provider", "unowned", "other-owner", "unavailable"]
    entityCount: Nonnegative
    decisionCount: Nonnegative
    operationCount: Nonnegative
    observedAt: Nonnegative
    rulesVersion: SimulationText | None = None
    policyVersion: SimulationText | None = None
    metrics: SimulationRunMetrics | None = None
    schedulerStop: SimulationSchedulerStop | None = None


class SimulationInspection(SimulationModel):
    """Observed native metadata or unmaterialized registered history."""

    run: SimulationSummary
    status: Literal["observed", "missing"]
    world: SimulationWorld | None = None
    operational: SimulationOperationalObserved | SimulationOperationalUnavailable | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationInspection:
        if (self.status == "observed") != (self.world is not None):
            raise ValueError("world metadata is present exactly for observed history")
        return self


class SimulationEntity(SimulationModel):
    """Participation and writer status are separate observations."""

    id: Identity
    name: SimulationText | None = None
    kind: SimulationText
    phase: EntityPhase
    cognition: Literal["none", "agent"]
    writer: Literal["none", "reserved", "active", "revoked", "released"]


class SimulationDecision(SimulationModel):
    """Exact simulated slot ordering, independent of business effects."""

    id: Identity
    entityId: Identity
    slot: Decimal
    time: Decimal
    snapshotRevision: Nonnegative
    status: DecisionStatus
    operationCount: Nonnegative


class SimulationOperation(SimulationModel):
    """Separate effect, publication, delivery and task facts."""

    id: Identity
    entityId: Identity
    decisionId: Identity
    index: Nonnegative
    kind: SimulationText
    status: OperationStatus
    publication: Literal["not-applicable", "pending", "published"]
    delivery: Literal["not-applicable", "pending", "input-persisted", "receipted"]
    deliveryFailure: Literal["unresolved", "retained-input", "absent-input", "entity-terminated"] | None = None
    task: Literal["not-applicable", "pending", "created"]


class SimulationCheckpoint(SimulationModel):
    """Retained checkpoint status does not prove current source validation."""

    id: Identity
    status: CheckpointStatus
    startedSequence: Nonnegative
    finishedSequence: Nonnegative | None = None
    time: Decimal | None = None
    publishedAt: Nonnegative | None = None
    latestSuccessful: bool
    sourceValidation: Literal["not-performed"]

    @model_validator(mode="after")
    def _publication(self) -> SimulationCheckpoint:
        if (self.status == "completed") != (self.publishedAt is not None):
            raise ValueError("only completed checkpoints carry publication time")
        return self



class SimulationBrowseInput(SimulationModel):
    """Collection-specific bounded filters."""

    runId: Identity
    collection: Collection
    limit: Annotated[int, Field(gt=0)] | None = None
    cursor: Identity | None = None
    phase: EntityPhase | None = None
    cognition: Literal["none", "agent"] | None = None
    status: str | None = None
    entityId: Identity | None = None
    decisionId: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationBrowseInput:
        allowed = {"entities": {"phase", "cognition"}, "decisions": {"status", "entityId"},
                   "operations": {"status", "entityId", "decisionId"}, "checkpoints": {"status"}}[self.collection]
        filters = self.model_fields_set - {"runId", "collection", "limit", "cursor"}
        if not filters <= allowed:
            raise ValueError("filters do not belong to the selected collection")
        statuses = {"decisions": {"open", "submitted", "accepted", "cancelled"},
                    "operations": {"pending", "applied", "rejected", "blocked-authority", "blocked-dependency", "outcome-unknown"},
                    "checkpoints": {"in-progress", "failed", "completed"}}
        if self.status is not None and self.status not in statuses.get(self.collection, set()):
            raise ValueError("status does not belong to the selected collection")
        return self


class SimulationCollectionPage(SimulationModel):
    """One authoritative filtered total and exact world revision."""

    runId: Identity
    collection: Collection
    snapshotRevision: Nonnegative
    observedAt: Nonnegative
    total: Nonnegative
    nextCursor: Identity | None = None
    items: list[SimulationEntity | SimulationDecision | SimulationOperation | SimulationCheckpoint]

    @model_validator(mode="after")
    def _validate(self) -> SimulationCollectionPage:
        expected = {"entities": SimulationEntity, "decisions": SimulationDecision,
                    "operations": SimulationOperation, "checkpoints": SimulationCheckpoint}[self.collection]
        if self.total < len(self.items) or any(not isinstance(item, expected) for item in self.items):
            raise ValueError("page items or total do not match the selected collection")
        return self


class SimulationKnowledgeReference(SimulationModel):
    """An exact retained premise; its identity does not authorize retrieval."""

    id: Identity
    revision: Annotated[int, Field(gt=0)]


class SimulationSelection(SimulationModel):
    """Exact administrative object and section."""

    collection: Collection
    id: Identity
    reference: SimulationKnowledgeReference | None = None
    section: Literal["identity", "relationships", "execution", "context", "knowledge", "attempts", "references"]

    @model_validator(mode="after")
    def _validate(self) -> SimulationSelection:
        _validate_section(self.collection, self.section)
        if self.reference is not None and (self.collection != "decisions" or self.section != "knowledge"):
            raise ValueError("knowledge reference is only valid for decision knowledge")
        return self


class SimulationObjectInput(SimulationModel):
    """Optional revision fence; pagination only for collection-bearing sections."""

    runId: Identity
    collection: Collection
    id: Identity
    reference: SimulationKnowledgeReference | None = None
    section: Literal["identity", "relationships", "execution", "context", "knowledge", "attempts", "references"]
    expectedRevision: Nonnegative | None = None
    limit: Annotated[int, Field(gt=0)] | None = None
    cursor: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationObjectInput:
        _validate_section(self.collection, self.section)
        if self.reference is not None and (self.collection != "decisions" or self.section != "knowledge"):
            raise ValueError("knowledge reference is only valid for decision knowledge")
        if self.section not in {"relationships", "context", "knowledge", "attempts", "references"} and self.model_fields_set & {"limit", "cursor"}:
            raise ValueError("this section has no pagination")
        return self


class SimulationBinding(SimulationModel):
    """Navigation references require independent Team/Session authorization."""

    teamId: Identity
    participantId: Identity
    sessionId: Identity


class SimulationEntityDetail(SimulationModel):
    """Exact entity metadata without private profile fields."""

    collection: Literal["entities"]
    section: Literal["identity"]
    id: Identity
    summary: SimulationEntity
    revision: Nonnegative
    profileRevision: Nonnegative
    writerEpoch: PositiveDecimal | None = None
    binding: SimulationBinding | None = None


class SimulationRelation(SimulationModel):
    """Historical half-open relation interval; current observation does not rewrite it."""

    id: Identity
    subject: Identity
    object: Identity
    relation: SimulationText
    scope: Identity | None = None
    revision: Nonnegative
    validFrom: Decimal
    validUntil: Decimal | None
    active: bool


class SimulationRelationPage(SimulationModel):
    """One independently bounded relation window."""

    items: list[SimulationRelation]
    total: Nonnegative
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationRelationPage:
        if self.total < len(self.items):
            raise ValueError("relation total is smaller than its page")
        return self


class SimulationRelationDetail(SimulationModel):
    """Exact entity relationships at an observed simulation tick."""

    collection: Literal["entities"]
    section: Literal["relationships"]
    id: Identity
    time: Decimal
    relationships: SimulationRelationPage


class SimulationInference(SimulationModel):
    """Real inference timestamps, distinct from simulation tick."""

    startedAt: Nonnegative
    deadline: Nonnegative
    finishedAt: Nonnegative | None = None
    expiredAt: Nonnegative | None = None


class SimulationContextAbsent(SimulationModel):
    """No frozen simulation context."""

    status: Literal["absent"]


class SimulationContextOverflow(SimulationModel):
    """Context exceeds its original bounded allowance."""

    status: Literal["overflow"]
    requiredBytes: Nonnegative
    maxBytes: Nonnegative


class SimulationContextPrepared(SimulationModel):
    """Frozen context accounting; bodies remain withheld."""

    status: Literal["prepared"]
    retainedBytes: Nonnegative
    maxBytes: Nonnegative
    knowledgeCount: Nonnegative
    sourceCount: Nonnegative
    sectionCount: Nonnegative
    content: Literal["withheld"]


class SimulationDecisionDetail(SimulationModel):
    """Decision execution and redacted context metadata."""

    collection: Literal["decisions"]
    section: Literal["execution"]
    id: Identity
    summary: SimulationDecision
    context: SimulationContextAbsent | SimulationContextOverflow | SimulationContextPrepared
    inference: SimulationInference | None = None
    closedAt: Nonnegative | None = None
    cancellation: Literal["requested", "writer-revoked", "scheduled-wake-cancelled", "timeout"] | None = None


class SimulationContextText(SimulationModel):
    """One Unicode-safe part of recorded plain text; not a complete model request."""

    status: Literal["text"]
    text: str
    part: Nonnegative
    parts: Annotated[int, Field(gt=0)]

    @model_validator(mode="after")
    def _validate(self) -> SimulationContextText:
        if self.part >= self.parts:
            raise ValueError("context part is outside the block")
        return self


class SimulationContextWithheld(SimulationModel):
    """Withheld and unsupported payloads contain no original content."""

    status: Literal["withheld", "unsupported"]


class SimulationContextSectionItem(SimulationModel):
    """Recorded section/block index and separately authorized text."""

    kind: Literal["section"]
    index: Nonnegative
    block: Nonnegative
    section: SimulationText
    required: bool
    body: SimulationContextText | SimulationContextWithheld


class SimulationContextKnowledgeItem(SimulationModel):
    """Exact frozen knowledge version, not current retrieval permission."""

    kind: Literal["knowledge"]
    id: Identity
    revision: Annotated[int, Field(gt=0)]


class SimulationContextRunItem(SimulationModel):
    """A sequence in this registered run; private native storage identity is omitted."""

    kind: Literal["run-event"]
    sequence: Annotated[int, Field(gt=0)]


class SimulationContextEnvelopeItem(SimulationModel):
    """Message reference requires independent Team body authorization."""

    sourceIndex: Nonnegative

    kind: Literal["team-envelope"]
    teamId: Identity
    channelId: Identity
    envelopeId: Identity


class SimulationContextPage(SimulationModel):
    """Ordered section parts and original evidence references."""

    items: list[SimulationContextSectionItem | SimulationContextKnowledgeItem | SimulationContextRunItem | SimulationContextEnvelopeItem]
    total: Nonnegative
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationContextPage:
        if self.total < len(self.items):
            raise ValueError("context total is smaller than its page")
        return self


class SimulationContextProjections(SimulationModel):
    """Original world/entity/Team projections, distinct from current revision."""

    run: Nonnegative
    entity: Nonnegative
    team: Nonnegative


class SimulationContextVersions(SimulationModel):
    """Bounded display versions from the frozen view."""

    rules: SimulationText
    policy: SimulationText
    persona: SimulationText
    model: SimulationText


class SimulationFrozenContext(SimulationModel):
    """Exact original context provenance without writer or model-request authority."""

    time: Decimal
    slot: Decimal
    entityId: Identity
    epoch: PositiveDecimal
    projections: SimulationContextProjections
    versions: SimulationContextVersions


class SimulationContextDetail(SimulationModel):
    """Frozen context metadata with explicit independent body disclosure."""

    collection: Literal["decisions"]
    section: Literal["context"]
    id: Identity
    readVersion: Identity
    accounting: SimulationContextAbsent | SimulationContextOverflow | SimulationContextPrepared
    bodyAccess: Literal["allowed", "withheld"]
    frozen: SimulationFrozenContext | None = None
    items: SimulationContextPage

    @model_validator(mode="after")
    def _validate(self) -> SimulationContextDetail:
        if (self.accounting.status == "prepared") != (self.frozen is not None):
            raise ValueError("frozen metadata does not match preparation")
        if self.accounting.status != "prepared" and self.items.total != 0:
            raise ValueError("unprepared context carries no rows")
        if self.bodyAccess == "withheld" and any(isinstance(item, SimulationContextSectionItem) and item.body.status != "withheld" for item in self.items.items):
            raise ValueError("context text was not authorized")
        return self


class SimulationEffectResult(SimulationModel):
    """Settled business effect without private diagnostic details."""

    status: Literal["applied", "rejected", "blocked-authority", "blocked-dependency"]
    time: Decimal
    sequence: Nonnegative
    code: SimulationText


class SimulationOutbox(SimulationModel):
    """Current publication readiness and retained attempt count."""

    ready: bool
    attemptCount: Nonnegative
    nextAttemptAt: Nonnegative | None = None


class SimulationTaskReference(SimulationModel):
    """Exact task identity, independent of task completion."""

    teamId: Identity
    taskId: Identity


class SimulationOperationDetail(SimulationModel):
    """Effect execution metadata; publishing does not imply recipient processing."""

    collection: Literal["operations"]
    section: Literal["execution"]
    id: Identity
    summary: SimulationOperation
    dependencies: list[Identity]
    result: SimulationEffectResult | None = None
    outbox: SimulationOutbox | None = None
    taskReference: SimulationTaskReference | None = None
    retry: SimulationOperationRetryCapability | None = None


class SimulationAttempt(SimulationModel):
    """One retained publication attempt."""

    number: Annotated[int, Field(gt=0)]
    startedAt: Nonnegative
    finishedAt: Nonnegative | None = None
    outcome: Literal["in-flight", "uncertain", "applied", "rejected", "blocked-authority"]


class SimulationAttemptPage(SimulationModel):
    """Bounded attempt window independent of the selected operation."""

    items: list[SimulationAttempt]
    total: Nonnegative
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationAttemptPage:
        if self.total < len(self.items):
            raise ValueError("total is smaller than the returned page")
        return self


class SimulationAttemptDetail(SimulationModel):
    """Exact paged publication history."""

    collection: Literal["operations"]
    section: Literal["attempts"]
    id: Identity
    attempts: SimulationAttemptPage


class SimulationRunReference(SimulationModel):
    """Checkpoint run prefix."""

    kind: Literal["run"]
    cursor: Nonnegative


class SimulationTeamReference(SimulationModel):
    """Checkpoint Team/channel prefix without content."""

    kind: Literal["team", "channel"]
    id: Identity
    cursor: Nonnegative


class SimulationMaterializedSession(SimulationModel):
    """Checkpoint Session prefix with independent read authority."""

    kind: Literal["session"]
    id: Identity
    teamId: Identity
    participantId: Identity
    materialization: Literal["materialized"]
    sequence: Annotated[int, Field(ge=-1)]


class SimulationUnmaterializedSession(SimulationModel):
    """Reserved Session has no materialized history."""

    kind: Literal["session"]
    id: Identity
    teamId: Identity
    participantId: Identity
    materialization: Literal["unmaterialized"]


class SimulationReferencePage(SimulationModel):
    """Bounded checkpoint source references."""

    items: list[SimulationRunReference | SimulationTeamReference | SimulationMaterializedSession | SimulationUnmaterializedSession]
    total: Nonnegative
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationReferencePage:
        if self.total < len(self.items):
            raise ValueError("total is smaller than the returned page")
        return self


class SimulationCheckpointDetail(SimulationModel):
    """Checkpoint source metadata; errors are redacted."""

    collection: Literal["checkpoints"]
    section: Literal["references"]
    id: Identity
    summary: SimulationCheckpoint
    references: SimulationReferencePage
    failure: Literal["details-withheld"] | None = None
    diagnostic: SimulationCheckpointDiagnostic | None = None

    @model_validator(mode="after")
    def _diagnosis(self) -> SimulationCheckpointDetail:
        if self.diagnostic is not None and self.summary.status != "failed":
            raise ValueError("Only failed checkpoints carry source diagnoses")
        return self


class SimulationKnowledgeSource(SimulationModel):
    """Source kind-specific fields, distinct from fact verification."""

    kind: Literal["observation", "report", "inference", "summary", "belief"]
    worldRevision: Nonnegative | None = None
    visibilityPolicy: SimulationText | None = None
    operationId: Identity | None = None
    body: SimulationContextText | SimulationContextWithheld | None = None
    decisionId: Identity | None = None
    confidence: Annotated[float, Field(ge=0, le=1)] | None = None
    cursor: Nonnegative | None = None
    policy: SimulationText | None = None
    policyVersion: SimulationText | None = None
    profileRevision: Nonnegative | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationKnowledgeSource:
        fields = {"observation": {"worldRevision", "visibilityPolicy"}, "report": {"operationId", "body"},
                  "inference": {"decisionId", "confidence"}, "summary": {"cursor", "policy", "policyVersion"},
                  "belief": {"profileRevision", "policyVersion", "confidence"}}[self.kind]
        if self.model_fields_set - {"kind"} - fields or any(getattr(self, field) is None for field in fields - {"confidence"}):
            raise ValueError("knowledge source fields do not match its kind")
        return self


class SimulationKnowledgeItem(SimulationModel):
    """One exact Unicode text part and its native provenance."""

    reference: SimulationKnowledgeReference
    owner: Identity
    observedAt: Decimal
    availableAt: Decimal
    validFrom: Decimal
    validUntil: Decimal | None
    sequence: Nonnegative
    body: SimulationContextText | SimulationContextWithheld
    source: SimulationKnowledgeSource
    premises: list[SimulationKnowledgeReference]


class SimulationKnowledgePage(SimulationModel):
    """Bounded authorized parts; totals do not count hidden knowledge."""

    items: list[SimulationKnowledgeItem]
    total: Nonnegative
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationKnowledgePage:
        if self.total < len(self.items):
            raise ValueError("knowledge total is smaller than its page")
        return self


class SimulationKnowledgeDetail(SimulationModel):
    """Current audience is rechecked even when the requested decision selected a historical version."""

    collection: Literal["entities", "decisions"]
    section: Literal["knowledge"]
    id: Identity
    readVersion: Identity
    bodyAccess: Literal["allowed", "withheld"]
    entityId: Identity
    time: Decimal
    cutoffRevision: Nonnegative
    selected: SimulationKnowledgeReference | None = None
    knowledge: SimulationKnowledgePage

    @model_validator(mode="after")
    def _validate(self) -> SimulationKnowledgeDetail:
        if self.bodyAccess == "withheld" and (self.knowledge.total or self.knowledge.items):
            raise ValueError("withheld knowledge cannot expose its identities or bodies")
        if self.collection != "decisions" and self.selected is not None:
            raise ValueError("exact frozen selection requires a decision")
        return self


class SimulationObjectInspection(SimulationModel):
    """Found data must match the exact selector; absence carries no object body."""

    runId: Identity
    snapshotRevision: Nonnegative
    observedAt: Nonnegative
    selection: SimulationSelection
    status: Literal["found", "missing"]
    value: SimulationKnowledgeDetail | SimulationEntityDetail | SimulationRelationDetail | SimulationDecisionDetail | SimulationContextDetail | SimulationOperationDetail | SimulationAttemptDetail | SimulationCheckpointDetail | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationObjectInspection:
        value = self.value
        if self.status == "missing":
            if value is not None:
                raise ValueError("missing objects carry no body")
        elif value is None or (value.collection, value.id, value.section) != (self.selection.collection, self.selection.id, self.selection.section):
            raise ValueError("object data does not match its exact selector")
        elif isinstance(value, SimulationKnowledgeDetail) and (value.selected != self.selection.reference or (value.selected is not None and any(item.reference != value.selected for item in value.knowledge.items))):
            raise ValueError("knowledge data does not match its exact reference")
        elif hasattr(value, "summary") and value.summary.id != value.id:
            raise ValueError("object summary has another identity")
        return self


def _validate_section(collection: str, section: str) -> None:
    allowed = {"entities": {"identity", "relationships", "knowledge"}, "decisions": {"execution", "context", "knowledge"},
               "operations": {"execution", "attempts"}, "checkpoints": {"references"}}
    if section not in allowed[collection]:
        raise ValueError("section does not belong to the selected collection")

class SimulationControlInput(SimulationModel):
    """Read current ownership without opening a writer."""

    runId: Identity


class SimulationManageInput(SimulationControlInput):
    """Original durable scheduling intent; no caller-selected owner or revision."""

    managementId: Identity
    phase: Literal["paused", "running"]


class SimulationManagementInput(SimulationControlInput):
    """Query the original scheduling outcome without resending it."""

    managementId: Identity


class SimulationControlAction(SimulationModel):
    """Observed precondition; every write rechecks it."""

    allowed: bool
    reason: Literal["ready", "recovery-required", "checkpoint-in-progress", "preparation-in-progress",
                    "management-in-progress", "stalled", "driver-failed", "execution-unavailable",
                    "review-required", "scenario-completed", "scenario-blocked", "outcome-unknown", "retiring"]

    @model_validator(mode="after")
    def _validate(self) -> SimulationControlAction:
        if self.allowed != (self.reason == "ready"):
            raise ValueError("allowed controls require a ready reason")
        return self


class SimulationControlActions(SimulationModel):
    """Independent scheduling admission observations."""

    start: SimulationControlAction
    pause: SimulationControlAction


class SimulationMaintenanceAction(SimulationModel):
    """Observed administrative admission, rechecked for each original write."""

    allowed: bool
    reason: Literal["ready", "preparation-in-progress", "request-capacity", "recovery-required", "retiring",
                    "checkpoint-in-progress", "management-in-progress", "checkpoint-required", "ownership-unavailable",
                    "scenario-progressed", "ingress-capacity", "target-unavailable"]

    @model_validator(mode="after")
    def _ready(self) -> SimulationMaintenanceAction:
        if self.allowed != (self.reason == "ready"):
            raise ValueError("allowed maintenance must be ready")
        return self


class SimulationMaintenanceActions(SimulationModel):
    """Separate administrative operation preconditions."""

    checkpoint: SimulationMaintenanceAction
    restore: SimulationMaintenanceAction
    prepare: SimulationMaintenanceAction
    ingress: SimulationMaintenanceAction


class SimulationIngressTarget(SimulationModel):
    """Allowed current scenario target with bounded display name."""

    id: Identity
    name: SimulationText


class SimulationIngressPolicy(SimulationModel):
    """Scenario horizon, native byte allowance and at most 32 current authorized targets."""

    maxTime: Decimal
    maxBytes: Annotated[int, Field(gt=0)]
    targets: Annotated[list[SimulationIngressTarget], Field(max_length=32)]


class SimulationRecoveryReferences(SimulationModel):
    """Reference counts identify the kinds of retained sources to verify."""

    runs: Nonnegative
    teams: Nonnegative
    channels: Nonnegative
    sessions: Nonnegative


class SimulationRecoveryAnchor(SimulationModel):
    """Compatible full checkpoint metadata; restore verifies its current suffix without rollback."""

    checkpointId: Identity
    publishedAt: Nonnegative
    time: Decimal
    revision: Nonnegative
    references: SimulationRecoveryReferences


class SimulationAdministrationControl(SimulationModel):
    """Administrative hints, allowed ingress targets and exact latest compatible recovery anchor."""

    actions: SimulationMaintenanceActions
    ingress: SimulationIngressPolicy
    recovery: SimulationRecoveryAnchor | None = None


class SimulationControlBudget(SimulationModel):
    """Installed model and immutable run limits; shared admission is Host-wide."""

    model: SimulationModelRoute
    tokensPerRequest: Annotated[int, Field(gt=0)]
    tokensPerInterval: Nonnegative
    interval: PositiveDecimal
    residentActors: Nonnegative
    sharedModelLimit: Annotated[int, Field(gt=0)]


class SimulationModelPoolUnavailable(SimulationModel):
    """No trusted Host pool observation; usage is never assumed to be zero."""

    status: Literal["unavailable"]
    clock: Literal["real"]
    observedAt: Nonnegative


class SimulationModelPoolObserved(SimulationModel):
    """Real-time Host-wide admission permits, separate from simulated per-run budget usage."""

    status: Literal["observed"]
    clock: Literal["real"]
    observedAt: ObservationCount
    active: ObservationCount
    queued: ObservationCount
    limit: Annotated[int, Field(gt=0, le=9_007_199_254_740_991)]
    queueLimit: ObservationCount

    @model_validator(mode="after")
    def _bounds(self) -> SimulationModelPoolObserved:
        if self.active > self.limit or self.queued > self.queueLimit:
            raise ValueError("Observed model pool occupancy exceeds its configured limits")
        return self


class SimulationControl(SimulationModel):
    """Separate scheduling intent, ownership and in-flight work."""

    runId: Identity
    administration: SimulationAdministrationControl
    budget: SimulationControlBudget
    modelPool: Annotated[SimulationModelPoolObserved | SimulationModelPoolUnavailable, Field(discriminator="status")] | None = None
    versions: SimulationVersionSummary | None = None
    owner: Literal["held", "not-held"]
    phase: Literal["paused", "running", "stalled"] | None = None
    revision: Nonnegative | None = None
    driver: Literal["idle", "scheduled", "advancing", "checkpointing", "waiting", "completed", "failed", "retiring"]
    inFlight: bool
    observedAt: Nonnegative
    stop: Literal["paused", "stalled", "until", "work-limit", "decision-required", "retry", "outcome-unknown",
                  "recipient-required", "recipient-busy", "coordination-limit", "resident-capacity",
                  "residency-recovery-required", "review-required", "completed", "scenario-blocked", "recovery-required"] | None = None
    nextAttemptAt: Nonnegative | None = None
    actions: SimulationControlActions


class SimulationManagementReceipt(SimulationModel):
    """Original scheduling fact; private diagnostics are withheld."""

    managementId: Identity
    phase: Literal["paused", "running"]
    status: Literal["in-progress", "completed", "failed"]
    startedSequence: Nonnegative
    finishedSequence: Nonnegative | None = None
    failure: Literal["details-withheld"] | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationManagementReceipt:
        if (self.status == "in-progress") != (self.finishedSequence is None):
            raise ValueError("terminal scheduling receipts require a finished sequence")
        if (self.status == "failed") != (self.failure is not None):
            raise ValueError("only failed scheduling receipts carry a redaction")
        return self


class SimulationManageResult(SimulationModel):
    """Original intent receipt and independent current control observation."""

    runId: Identity
    operation: SimulationManagementReceipt
    control: SimulationControl

    @model_validator(mode="after")
    def _validate(self) -> SimulationManageResult:
        if self.runId != self.control.runId:
            raise ValueError("control belongs to another run")
        return self


class SimulationManagementResult(SimulationModel):
    """Exact original scheduling result; absence does not establish failure."""

    runId: Identity
    managementId: Identity
    status: Literal["found", "not-found"]
    operation: SimulationManagementReceipt | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationManagementResult:
        if (self.status == "found") != (self.operation is not None):
            raise ValueError("found scheduling results require their original receipt")
        if self.operation is not None and self.operation.managementId != self.managementId:
            raise ValueError("receipt belongs to another management identity")
        return self


class SimulationCheckpointInput(SimulationControlInput):
    """Full checkpoint policy and new checkpoint identity are Host-derived."""

    commandId: Identity


class SimulationRestoreInput(SimulationCheckpointInput):
    """Verify a retained checkpoint and current suffix without rollback or inference."""

    checkpointId: Identity


class SimulationIngressInput(SimulationControlInput):
    """One entity input; attribution is derived from the authenticated caller."""

    ingressId: Identity
    entityId: Identity
    text: Identity
    availableAt: Decimal


class SimulationIngressQuery(SimulationControlInput):
    """Query assignment and consumption independently of scheduling."""

    ingressId: Identity


class SimulationIngressReceipt(SimulationModel):
    """Assignment and consumption facts without private text or author identity."""

    runId: Identity
    ingressId: Identity
    entityId: Identity
    eventId: Identity
    availableAt: Decimal
    assignedAt: Decimal
    sequence: Nonnegative
    status: Literal["pending", "claimed", "consumed", "cancelled"]
    decisionId: Identity | None = None


class SimulationIngressResult(SimulationModel):
    """Original input fact or non-authoritative absence."""

    runId: Identity
    ingressId: Identity
    status: Literal["found", "not-found"]
    receipt: SimulationIngressReceipt | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationIngressResult:
        if (self.status == "found") != (self.receipt is not None):
            raise ValueError("found input results require their original receipt")
        if self.receipt is not None and (self.receipt.runId != self.runId or self.receipt.ingressId != self.ingressId):
            raise ValueError("receipt belongs to another run or input")
        return self


class SimulationWatchInput(SimulationModel):
    """One bounded authenticated real-time wait, without execution or body parameters."""

    runId: Identity
    cursor: Identity | None = None
    waitMs: Annotated[int, Field(ge=0, le=2147483647)] | None = None


class SimulationWatchObserved(SimulationModel):
    """Exact observed native revision; no clock conversion or world body."""

    status: Literal["observed"]
    revision: Nonnegative


class SimulationWatchUnavailable(SimulationModel):
    """Missing history and unavailable observation remain distinct."""

    status: Literal["missing", "unavailable"]


class SimulationWatchResult(SimulationModel):
    """Non-authorizing policy lifetime and opaque credential-bound continuation."""

    runId: Identity
    readVersion: Identity
    cursor: Identity
    status: Literal["changed", "unchanged", "reset"]
    world: SimulationWatchObserved | SimulationWatchUnavailable
    observedAt: Nonnegative


class SimulationRecordsInput(SimulationModel):
    """Exact journal filters; original mode requires separate whole-run historical access."""

    runId: Identity
    mode: Literal["metadata", "original"]
    kind: Annotated[str, Field(min_length=1, max_length=128)] | None = None
    sequence: Nonnegative | None = None
    expectedRevision: Nonnegative | None = None
    limit: Annotated[int, Field(gt=0)] | None = None
    cursor: Identity | None = None


class SimulationRecordsSelection(SimulationModel):
    """Exact filters echoed independently from opaque continuation."""

    kind: Annotated[str, Field(min_length=1, max_length=128)] | None = None
    sequence: Nonnegative | None = None


class SimulationRecordBody(SimulationModel):
    """Original JSON text part, not an executable or structured world mutation."""

    status: Literal["text"]
    text: str
    part: Nonnegative
    parts: Annotated[int, Field(gt=0)]

    @model_validator(mode="after")
    def validate_part(self) -> SimulationRecordBody:
        """Reject an index beyond the original record's text part count."""
        if self.part >= self.parts:
            raise ValueError("Record text part exceeds its count")
        return self


class SimulationRecordWithheld(SimulationModel):
    """Original journal content is not permitted or was not requested."""

    status: Literal["withheld"]


class SimulationRecordItem(SimulationModel):
    """One original sequence and its bounded type metadata and body part."""

    sequence: Nonnegative
    kind: SimulationText
    action: SimulationText | None = None
    body: Annotated[SimulationRecordBody | SimulationRecordWithheld, Field(discriminator="status")]


class SimulationRecordsPage(SimulationModel):
    """Bounded policy-tagged journal response; totalRecords counts records, not text parts."""

    runId: Identity
    snapshotRevision: Nonnegative
    readVersion: Identity
    observedAt: Nonnegative
    mode: Literal["metadata", "original"]
    bodyAccess: Literal["allowed", "withheld"]
    totalRecords: Nonnegative
    selection: SimulationRecordsSelection
    items: list[SimulationRecordItem]
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def validate_disclosure(self) -> SimulationRecordsPage:
        """Require both explicit original mode and permission for any body text."""
        if (self.mode != "original" or self.bodyAccess != "allowed") and any(item.body.status == "text" for item in self.items):
            raise ValueError("Record text requires original-content permission")
        return self


class SimulationSourceInput(SimulationModel):
    """Select only a retained decision source; no Team, principal or body switch is accepted."""

    runId: Identity
    decisionId: Identity
    sourceIndex: Nonnegative
    envelopeSequence: Nonnegative | None = None
    expectedRevision: Nonnegative | None = None
    cursor: Identity | None = None
    limit: Annotated[int, Field(gt=0)] | None = None


class SimulationEnvelopeSource(SimulationModel):
    """Frozen reference does not confirm target existence or grant access."""

    kind: Literal["team-envelope"]
    teamId: Identity
    channelId: Identity
    envelopeId: Identity


class SimulationSourceEnvelope(SimulationModel):
    """Exact authorized original position and real acceptance time."""

    sequence: Nonnegative
    kind: SimulationText
    createdAt: Nonnegative


class SimulationSourceBlock(SimulationModel):
    """Ordered inert text or a withheld unsupported provider payload."""

    block: Nonnegative
    body: SimulationContextText | SimulationContextWithheld


class SimulationSourceInspection(SimulationModel):
    """A bounded source lookup or body page under independent Simulation and Team permission."""

    runId: Identity
    decisionId: Identity
    sourceIndex: Nonnegative
    snapshotRevision: Nonnegative
    readVersion: Identity
    observedAt: Nonnegative
    source: SimulationEnvelopeSource | None = None
    status: Literal["missing", "withheld", "unavailable", "searching", "found"]
    envelope: SimulationSourceEnvelope | None = None
    items: list[SimulationSourceBlock]
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationSourceInspection:
        """Only found sources expose content; only found or searching results continue."""
        if self.status == "found":
            if self.source is None or self.envelope is None:
                raise ValueError("Found source requires reference and exact position")
        elif self.envelope is not None or self.items:
            raise ValueError("Only found sources carry content")
        if self.status == "searching":
            if self.nextCursor is None or self.source is None:
                raise ValueError("Searching source requires a continuation and reference")
        elif self.status != "found" and self.nextCursor is not None:
            raise ValueError("Only found or searching sources continue")
        return self


class SimulationTaskReviewListInput(SimulationModel):
    """Owned run and exact bounded canonical review observation."""

    runId: Identity
    limit: Annotated[int, Field(gt=0)] | None = None
    cursor: Identity | None = None
    expectedRevision: Nonnegative | None = None


class SimulationTaskReviewResolveInput(SimulationModel):
    """Original immutable scene review command; reviewer authority comes from the Host."""

    runId: Identity
    commandId: Identity
    operationId: Identity
    attemptId: Identity
    expectedRevision: Annotated[int, Field(gt=0)]
    nextPhase: Literal["completed", "pending"]
    reason: Annotated[str, Field(min_length=1)]


class SimulationTaskReviewAction(SimulationModel):
    """Observed action hint, rechecked at the canonical write position."""

    allowed: bool
    reason: Literal["ready", "review-disabled", "recovery-required", "maintenance-in-progress", "target-changed", "review-unavailable"]

    @model_validator(mode="after")
    def _validate(self) -> SimulationTaskReviewAction:
        if self.allowed != (self.reason == "ready"):
            raise ValueError("Only ready review hints allow submission")
        return self


class SimulationTaskReviewTransfer(SimulationModel):
    """Fixed one-unit purchase effect; account balances remain private."""

    operationId: Identity
    status: Literal["applied"]
    quantity: Literal["1"]


class SimulationTaskReviewReport(SimulationModel):
    """Current attempt's durably admitted report; text remains private."""

    operationId: Identity
    delivery: Literal["persisted"]


class SimulationTaskReviewEvidence(SimulationModel):
    """Only trusted scene-owned effects support an administrative review."""

    inventoryTransfer: SimulationTaskReviewTransfer | None = None
    report: SimulationTaskReviewReport


class SimulationTaskReviewSummary(SimulationModel):
    """Exact canonical source/attempt metadata without task bodies or general Team grants."""

    operationId: Identity
    teamId: Identity
    taskId: Identity
    attemptId: Identity
    taskRevision: Annotated[int, Field(gt=0)]
    reviewerEntityId: Identity
    phase: Literal["pending", "assigned", "running", "review", "completed", "failed", "cancelled", "deleted"]
    attemptCount: Nonnegative
    maxAttempts: Annotated[int, Field(gt=0)]
    evidence: SimulationTaskReviewEvidence | None = None
    action: SimulationTaskReviewAction

    @model_validator(mode="after")
    def _evidence(self) -> SimulationTaskReviewSummary:
        if self.action.allowed and self.evidence is None:
            raise ValueError("An allowed review requires fixed scene evidence")
        return self


class SimulationTaskReviewPage(SimulationModel):
    """Complete bounded run-owned review metadata window."""

    runId: Identity
    snapshotRevision: Nonnegative
    observedAt: Nonnegative
    items: list[SimulationTaskReviewSummary]
    total: Nonnegative
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationTaskReviewPage:
        if self.total < len(self.items):
            raise ValueError("Review total must include its page")
        return self




class SimulationScenarioUnavailable(SimulationModel):
    """A directory name or native rule version cannot identify an installed scenario."""

    status: Literal["unavailable"]


class SimulationScenarioObserved(SimulationModel):
    """Scenario identity comes from the retained trusted template resolution."""

    status: Literal["observed"]
    templateId: SimulationText
    version: Literal["1"]
    driverVersion: Literal["1"]
    execution: Literal["cognition-only", "automatic-tasks"]


class SimulationVersionSummary(SimulationModel):
    """Immutable rule/policy and tick labels stay separate from runtime scheduling."""

    rulesVersion: SimulationText
    policyVersion: SimulationText
    tickUnit: SimulationText
    scenario: Annotated[SimulationScenarioObserved | SimulationScenarioUnavailable, Field(discriminator="status")]


class SimulationOperationalUnavailable(SimulationModel):
    """No company administration observation, while native directory reads may remain available."""

    status: Literal["unavailable"]
    observedAt: Nonnegative
    scenario: SimulationScenarioUnavailable


class SimulationOperationalObserved(SimulationModel):
    """Current company scheduling metadata grants no control or task authority."""

    status: Literal["observed"]
    observedAt: Nonnegative
    scenario: Annotated[SimulationScenarioObserved | SimulationScenarioUnavailable, Field(discriminator="status")]
    owner: Literal["held", "not-held"]
    driver: Literal["idle", "scheduled", "advancing", "checkpointing", "waiting", "completed", "failed", "retiring"]
    inFlight: bool
    stop: Literal["paused", "stalled", "until", "work-limit", "decision-required", "retry", "outcome-unknown",
                  "recipient-required", "recipient-busy", "coordination-limit", "resident-capacity",
                  "residency-recovery-required", "review-required", "completed", "scenario-blocked", "recovery-required"] | None = None
    nextAttemptAt: Nonnegative | None = None


class SimulationRunStatusesInput(SimulationModel):
    """Exact bounded registered identities; one unknown identity never grants access to another row."""

    runIds: list[Identity]

    @model_validator(mode="after")
    def _unique(self) -> SimulationRunStatusesInput:
        if len(set(self.runIds)) != len(self.runIds):
            raise ValueError("Status batches require distinct exact run identities")
        return self


class SimulationRunStatusUnavailable(SimulationModel):
    """A provider observation failure is separate from an unmaterialized registered run."""

    run: SimulationSummary
    status: Literal["unavailable"]
    errorSummary: SimulationText
    operational: Annotated[SimulationOperationalObserved | SimulationOperationalUnavailable, Field(discriminator="status")] | None = None


class SimulationRunStatusesPage(SimulationModel):
    """Ordered independent run observations and one real-time shared Host pool observation."""

    items: list[Annotated[SimulationInspection | SimulationRunStatusUnavailable, Field(discriminator="status")]]
    modelPool: Annotated[SimulationModelPoolObserved | SimulationModelPoolUnavailable, Field(discriminator="status")] | None = None


class SimulationBudgetUsage(SimulationModel):
    """Actual interval usage may exceed a cap after an observed overrun."""

    used: ObservationCount
    limit: ObservationCount


class SimulationTokenCharges(SimulationModel):
    """Reservations and unknown attempts remain charged; they are not live Host permits."""

    charged: ObservationCount
    limit: ObservationCount
    unknownAttempts: ObservationCount


class SimulationIntervalBudgets(SimulationModel):
    """Canonical simulated interval and immutable interval width."""

    interval: Decimal
    width: PositiveDecimal
    tokens: SimulationTokenCharges
    decisions: SimulationBudgetUsage
    messages: SimulationBudgetUsage


class SimulationResidentSlots(SimulationBudgetUsage):
    """Reserved and revoked writers retain occupancy until confirmed release."""

    recoveryRequired: ObservationCount

    @model_validator(mode="after")
    def _recovery(self) -> SimulationResidentSlots:
        if self.recoveryRequired > self.used:
            raise ValueError("Recovery slots cannot exceed retained writer occupancy")
        return self


class SimulationRunMetrics(SimulationModel):
    """Authoritative native budget, residency and pending-work observations, without bodies."""

    budgets: SimulationIntervalBudgets
    residentSlots: SimulationResidentSlots
    pendingDecisionCount: ObservationCount
    pendingExternalOperationCount: ObservationCount
    unknownOperationCount: ObservationCount


class SimulationSchedulerStop(SimulationModel):
    """Native public stop and recovery categories omit private stall references."""

    code: Identity
    recovery: Identity


SimulationWorld.model_rebuild()
SimulationInspection.model_rebuild()
SimulationControl.model_rebuild()
SimulationManageResult.model_rebuild()
SimulationRunStatusesPage.model_rebuild()


class SimulationOperationRetryInput(SimulationModel):
    """Original bounded retry grant; target, observed attempt count and reason are immutable."""

    runId: Identity
    commandId: Identity
    operationId: Identity
    expectedAttemptCount: Annotated[int, Field(gt=0, le=9_007_199_254_740_991)]
    reason: Identity

    @field_validator("commandId")
    @classmethod
    def _command(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("Operation retry command identity must be trimmed")
        return value

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        result = value.strip()
        if not result:
            raise ValueError("Operation retry reason must be nonempty")
        return result





class SimulationOperationRetryCapability(SimulationModel):
    """Observed bounded retry admission; it never grants authority or changes a retained target/count."""

    allowed: bool
    reason: Literal["ready", "not-external", "outcome-known", "not-unknown", "not-due", "maintenance-in-progress", "recovery-required",
                    "request-in-progress", "capacity-unavailable"]
    expectedAttemptCount: ObservationCount
    maxAttempts: Annotated[int, Field(gt=0, le=9_007_199_254_740_991)]

    @model_validator(mode="after")
    def _admission(self) -> SimulationOperationRetryCapability:
        if self.allowed != (self.reason == "ready") or (self.allowed and self.expectedAttemptCount == 0):
            raise ValueError("Only exact ready unknown attempts can be retried")
        return self


SimulationOperationDetail.model_rebuild()


class SimulationCheckpointRunSubject(SimulationModel):
    """The run owner or journal failed without exposing a physical path."""

    kind: Literal["run"]


class SimulationCheckpointAnchorSubject(SimulationModel):
    """Exact retained checkpoint identity, not a caller-selected storage path."""

    kind: Literal["checkpoint"]
    checkpointId: Identity


class SimulationCheckpointTeamSubject(SimulationModel):
    """Canonical Team reference at which validation stopped."""

    kind: Literal["team"]
    teamId: Identity


class SimulationCheckpointChannelSubject(SimulationModel):
    """Canonical channel reference at which validation stopped."""

    kind: Literal["channel"]
    channelId: Identity
    teamId: Identity


class SimulationCheckpointSessionSubject(SimulationModel):
    """Exact Session and its immutable expected Team/participant association."""

    kind: Literal["session"]
    sessionId: Identity
    teamId: Identity
    participantId: Identity


class SimulationCheckpointEntitySubject(SimulationModel):
    """Canonical entity whose owned lifecycle failed."""

    kind: Literal["entity"]
    entityId: Identity


class SimulationCheckpointDiagnostic(SimulationModel):
    """Finite safe failure metadata; provider messages, paths and raw causes are forbidden."""

    stage: Literal["collect", "validate", "restore", "retire", "publish"]
    code: Literal["source-unavailable", "source-moved", "history-incomplete", "binding-mismatch", "owner-conflict",
                  "owner-not-quiescent", "unsupported-ownership", "manifest-mismatch", "version-mismatch", "cancelled", "unavailable"]
    subject: Annotated[SimulationCheckpointRunSubject | SimulationCheckpointAnchorSubject | SimulationCheckpointTeamSubject |
                       SimulationCheckpointChannelSubject | SimulationCheckpointSessionSubject | SimulationCheckpointEntitySubject,
                       Field(discriminator="kind")]
    cleanup: Literal["unconfirmed"] | None = None


SimulationRequestReceipt.model_rebuild()
SimulationRequestResult.model_rebuild()

SimulationCheckpointDetail.model_rebuild()
SimulationObjectInspection.model_rebuild()


class SimulationRequestsInput(SimulationModel):
    """Exact authorized run and bounded revision-pinned original receipt selection."""

    runId: Identity
    limit: Annotated[int, Field(gt=0)] | None = None
    cursor: Identity | None = None
    expectedRevision: Nonnegative | None = None


class SimulationRequestsPage(SimulationModel):
    """Original administrative receipt metadata without private command inputs."""

    runId: Identity
    snapshotRevision: Nonnegative
    items: list[SimulationRequestReceipt]
    total: Nonnegative
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def _selection(self) -> SimulationRequestsPage:
        if self.total < len(self.items) or any(item.runId != self.runId for item in self.items):
            raise ValueError("Original receipt page must preserve its authorized run and complete count")
        if len({item.commandId for item in self.items}) != len(self.items):
            raise ValueError("Original receipt page requires distinct command identities")
        return self


class SimulationRetryRequestInput(SimulationModel):
    """Exact original command selected for replay from backend-retained input."""

    runId: Identity
    commandId: Identity
