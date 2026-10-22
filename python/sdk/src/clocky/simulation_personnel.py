"""Exact metadata-only personnel owner references; inventories confer no mutation or departure authority."""
from __future__ import annotations
from typing import Annotated, Literal
from pydantic import Field, model_serializer
from .simulation_base import SimulationModel, Identity, Decimal, PositiveDecimal, ObservationCount

Revision = Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]


class PersonnelModel(SimulationModel):
    @model_serializer(mode="wrap")
    def _required_nulls(self, handler):
        value = handler(self)
        for name, field in type(self).model_fields.items():
            if field.is_required() and getattr(self, name) is None:
                value[field.alias or name] = None
        return value


class PersonnelNativeOwner(PersonnelModel):
    kind: Literal["native"]
    runId: Identity
    subsystem: Literal["decision", "operation", "outbox", "interaction", "resource", "scheduler", "relation", "writer", "world", "task"]


class PersonnelTeamOwner(PersonnelModel):
    kind: Literal["team"]
    teamId: Identity


class PersonnelChannelOwner(PersonnelModel):
    kind: Literal["channel"]
    channelId: Identity


PersonnelOwner = Annotated[PersonnelNativeOwner | PersonnelTeamOwner | PersonnelChannelOwner, Field(discriminator="kind")]


class PersonnelDecision(PersonnelModel):
    kind: Literal["decision"]
    id: Identity
    epoch: PositiveDecimal
    slot: Decimal
    priority: Annotated[int, Field(ge=-1000, le=1000)] | None = None


class PersonnelOperation(PersonnelModel):
    kind: Literal["operation"]
    id: Identity
    decisionId: Identity
    index: ObservationCount
    fingerprint: Identity


class PersonnelOutbox(PersonnelModel):
    kind: Literal["outbox"]
    operationId: Identity
    fingerprint: Identity
    attempt: Revision | None


class PersonnelTaskAssignment(PersonnelModel):
    kind: Literal["task-assignment"]
    teamId: Identity
    taskId: Identity
    attemptId: Identity
    operationId: Identity
    selectedRevision: Revision
    reservedSequence: Revision


class PersonnelTaskExecution(PersonnelModel):
    kind: Literal["task-execution"]
    teamId: Identity
    taskId: Identity
    attemptId: Identity
    selectedRevision: Revision
    observedRevision: Revision | None


class PersonnelTaskTarget(PersonnelModel):
    kind: Literal["task-target"]
    teamId: Identity
    taskId: Identity
    operationId: Identity
    fingerprint: Identity


class PersonnelInteraction(PersonnelModel):
    kind: Literal["interaction", "commitment"]
    id: Identity
    revision: Revision


class PersonnelResource(PersonnelModel):
    kind: Literal["resource"]
    id: Identity
    revision: Revision
    relation: Literal["owner", "controller"]


class PersonnelGrant(PersonnelModel):
    kind: Literal["resource-grant"]
    id: Identity
    revision: Revision
    relation: Literal["issuer", "grantee"]


class PersonnelEventKey(PersonnelModel):
    time: Decimal
    microstep: Decimal
    phase: Literal["delivery", "decision", "deadline"]
    slot: Decimal


class PersonnelScheduled(PersonnelModel):
    kind: Literal["scheduled-event"]
    id: Identity
    key: PersonnelEventKey


class PersonnelWake(PersonnelModel):
    kind: Literal["wake"]
    eventId: Identity
    decisionId: Identity | None


class PersonnelMessage(PersonnelModel):
    kind: Literal["message"]
    operationId: Identity
    channelId: Identity
    recipientEntityId: Identity
    direction: Literal["incoming", "outgoing"]
    envelopeId: Identity | None


class PersonnelRelation(PersonnelModel):
    kind: Literal["relation"]
    id: Identity
    revision: Revision
    relation: Identity
    subject: Identity
    object: Identity
    scope: Identity | None
    validFrom: Decimal
    validUntil: Decimal | None


class PersonnelWriter(PersonnelModel):
    kind: Literal["writer"]
    entityId: Identity
    epoch: PositiveDecimal
    reservationId: Identity
    activationId: Identity | None


class PersonnelWorldReservation(PersonnelModel):
    kind: Literal["world-reservation"]
    intentId: Identity
    requestId: Identity
    planId: Identity
    updatedSequence: Revision


class PersonnelWorldCase(PersonnelModel):
    kind: Literal["world-case"]
    requestId: Identity
    intentId: Identity
    sequence: Revision


class PersonnelTeamTask(PersonnelModel):
    kind: Literal["team-task"]
    teamId: Identity
    taskId: Identity
    revision: Revision
    relation: Literal["creator", "owner", "executor", "reviewer", "proposed-owner"]


class PersonnelTeamAttempt(PersonnelModel):
    kind: Literal["team-attempt"]
    teamId: Identity
    taskId: Identity
    attemptId: Identity
    revision: Revision


class PersonnelDelivery(PersonnelModel):
    kind: Literal["channel-delivery"]
    channelId: Identity
    envelopeId: Identity
    recipientId: Identity
    sequence: ObservationCount
    direction: Literal["incoming", "outgoing"]


class PersonnelActivation(PersonnelModel):
    kind: Literal["team-activation"]
    teamId: Identity
    activationId: Identity
    reservationId: Identity | None


class PersonnelStartup(PersonnelModel):
    kind: Literal["team-startup"]
    teamId: Identity
    participantId: Identity
    reservationId: Identity


class PersonnelWorkspace(PersonnelModel):
    kind: Literal["team-workspace"]
    teamId: Identity
    allocationId: Identity
    taskId: Identity
    attemptId: Identity
    revision: Revision


PersonnelReference = Annotated[PersonnelDecision | PersonnelOperation | PersonnelOutbox | PersonnelTaskAssignment
    | PersonnelTaskExecution | PersonnelTaskTarget | PersonnelInteraction | PersonnelResource | PersonnelGrant
    | PersonnelScheduled | PersonnelWake | PersonnelMessage | PersonnelRelation | PersonnelWriter | PersonnelWorldReservation
    | PersonnelWorldCase | PersonnelTeamTask | PersonnelTeamAttempt | PersonnelDelivery | PersonnelActivation
    | PersonnelStartup | PersonnelWorkspace, Field(discriminator="kind")]


class PersonnelOriginal(PersonnelModel):
    """Original owner and reference at the exact Native cursor; this alone has no navigable destination."""
    owner: PersonnelOwner
    ref: PersonnelReference
    cursor: ObservationCount
