"""Failure DTOs accept only safe metadata, without implicit recovery authority."""
from uuid import uuid4

import pytest
from pydantic import ValidationError
from clocky.simulation import SimulationFailure


def sample():
    return dict(failureId=str(uuid4()), ownerId=str(uuid4()), batchId=str(uuid4()),
                occurredAt=1, revision=12, category="payment-required",
                retryDisposition="account-action", actionCode="check-account")


def test_safe_failure_and_raw_diagnostic_rejection():
    value = sample()
    assert SimulationFailure.model_validate(value).category == "payment-required"
    for field in ("message", "requestId", "body", "path"):
        with pytest.raises(ValidationError):
            SimulationFailure.model_validate({**value, field: "private token=secret"})


@pytest.mark.parametrize("delay", [0, -1, 86400001, float("inf"), "1000"])
def test_retry_delay_is_bounded(delay):
    with pytest.raises(ValidationError):
        SimulationFailure.model_validate({**sample(), "providerRetryAfterMs": delay})


@pytest.mark.parametrize("field", ["failureId", "ownerId", "batchId"])
@pytest.mark.parametrize("identity", ["12345678-1234-0234-8234-123456789abc", "12345678-1234-4234-1234-123456789abc"])
def test_failure_identity_requires_the_native_uuid_version_and_variant(field, identity):
    with pytest.raises(ValidationError):
        SimulationFailure.model_validate({**sample(), field: identity})


@pytest.mark.parametrize("identity", ["00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"])
def test_failure_identity_preserves_native_nil_and_max_uuid_variants(identity):
    assert SimulationFailure.model_validate({**sample(), "failureId": identity}).failureId == identity


@pytest.mark.parametrize("field", ["occurredAt", "revision"])
def test_failure_counters_preserve_native_safe_integer_limits(field):
    with pytest.raises(ValidationError):
        SimulationFailure.model_validate({**sample(), field: 9_007_199_254_740_992})
