"""Strict helpers for explicitly authorized original Native funding records; public queries never expose raw snapshots."""
from __future__ import annotations
from typing import Annotated, Literal
from pydantic import AfterValidator, Field, StrictStr, model_validator
from .simulation_base import (ManagementCommandId, Identity, Decimal, PositiveDecimal, ObservationCount,
    utf16_code_units, canonical_javascript_string)
from .simulation_world_management import ManagementModel, ManagementHiringFee, Positive, Hash


def _management_authority_text(value: str) -> str:
    """Match the Native management source/funding policy text scalar without trimming its original value."""
    if not value or utf16_code_units(value) > 1024:
        raise ValueError("Management authority text requires 1 to 1024 UTF-16 code units")
    return canonical_javascript_string(value)


ManagementAuthorityText = Annotated[StrictStr, AfterValidator(_management_authority_text)]


class NativeAuthenticatedUserSource(ManagementModel):
    """Non-secret actual acceptance identity; a principal is never substituted for an Entity."""
    kind: Literal["authenticated-user"]
    commandId: ManagementCommandId
    principalId: ManagementAuthorityText
    credentialGeneration: ObservationCount
    policyRef: ManagementAuthorityText
    policyGeneration: ManagementAuthorityText
    time: Decimal


class NativeFundingRead(ManagementModel):
    resourceId: Identity
    revision: Positive


class NativeFundingTransfer(ManagementModel):
    from_: Identity = Field(alias="from")
    to: Identity
    quantity: PositiveDecimal


class NativeFundingTransaction(ManagementModel):
    commitmentId: Identity | None
    reads: Annotated[list[NativeFundingRead], Field(min_length=1)]
    transfers: Annotated[list[NativeFundingTransfer], Field(min_length=1)]


class NativeApprovalNorm(ManagementModel):
    id: Identity
    version: PositiveDecimal


class NativeHiringApproval(ManagementModel):
    proposalId: Identity
    proposalHash: Hash
    resolutionId: Identity
    resolutionHash: Hash
    norm: NativeApprovalNorm


class NativeFundingExpiry(ManagementModel):
    eventId: Identity
    sequence: ObservationCount
    time: Decimal


class NativeWorldFunding(ManagementModel):
    intentId: Identity
    planId: Identity
    fee: ManagementHiringFee
    approvals: list[NativeHiringApproval]
    expiryConsumed: NativeFundingExpiry | None = None


class NativeOperationSettlement(ManagementModel):
    kind: Literal["operation"]
    operationId: Identity
    sequence: ObservationCount
    time: Decimal


class NativeExpirySettlement(ManagementModel):
    kind: Literal["expiry"]
    eventId: Identity
    sequence: ObservationCount
    time: Decimal


class NativeWorldSettlement(ManagementModel):
    kind: Literal["world"]
    intentId: Identity
    planId: Identity
    transition: Literal["committed", "cancelled"]
    sequence: ObservationCount
    time: Decimal


def _resource_reservation_id(value: str) -> str:
    """Retain the Native reservation owner's 256 UTF-16-unit limit after common identity parsing."""
    if utf16_code_units(value) > 256:
        raise ValueError("Resource reservation identity exceeds 256 UTF-16 code units")
    return value


class NativeResourceReservation(ManagementModel):
    """Native96 original creation provenance; required operation-null and commitment-null survive wire serialization."""
    id: Annotated[Identity, AfterValidator(_resource_reservation_id)]
    actorId: Identity
    transaction: NativeFundingTransaction
    grants: list[Identity]
    expiresAt: Decimal
    createdTime: Decimal
    createdOperationId: Identity | None
    management: NativeAuthenticatedUserSource | None = None
    sequence: ObservationCount
    revision: Positive
    world: NativeWorldFunding | None = None
    phase: Literal["active", "committed", "cancelled", "expired"]
    settlement: Annotated[NativeOperationSettlement | NativeExpirySettlement | NativeWorldSettlement, Field(discriminator="kind")] | None = None

    @model_validator(mode="after")
    def _source(self):
        if (self.createdOperationId is None) != (self.management is not None) or self.createdOperationId is None and self.world is None:
            raise ValueError("User funding requires its actual original management and World source")
        if (self.phase == "active") != (self.settlement is None):
            raise ValueError("Terminal holds require their exact original settlement")
        if int(self.expiresAt) <= int(self.createdTime):
            raise ValueError("Original expiry must follow its actual creation clock")
        return self
