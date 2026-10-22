"""Strict durable stop controls; command receipts do not imply current scheduling or backup success."""
from __future__ import annotations
from typing import Annotated, Literal
from pydantic import Field, AfterValidator
from .simulation_base import SimulationModel, Identity, Decimal, ObservationCount, utf16_code_units

def _control_id(value: str) -> str:
    if not 1 <= utf16_code_units(value) <= 128:
        raise ValueError("Control identity must contain 1 to 128 UTF-16 units")
    return value

ControlId = Annotated[str, AfterValidator(_control_id)]

def _bounded_stop_text(value: str) -> str:
    if utf16_code_units(value) > 256:
        raise ValueError("Stop-clock metadata exceeds 256 UTF-16 units")
    return value

StopPinText = Annotated[Identity, AfterValidator(_bounded_stop_text)]
StopTime = Annotated[Decimal, AfterValidator(_bounded_stop_text)]

class StopDomainPin(SimulationModel):
    domain: StopPinText
    operation: StopPinText
    version: StopPinText
    schemaRef: StopPinText
    implementationRef: StopPinText
    generation: ObservationCount

class NativeStopClock(SimulationModel):
    kind: Literal["native"]

class DomainStopClock(SimulationModel):
    kind: Literal["domain"]
    pin: StopDomainPin
    name: ControlId

class StopDrainBudget(SimulationModel):
    maxSteps: Annotated[int, Field(gt=0, le=9_007_199_254_740_991)]
    maxTokens: Annotated[int, Field(gt=0, le=9_007_199_254_740_991)]
    maxWallTimeMs: Annotated[int, Field(gt=0, le=9_007_199_254_740_991)]

class SimulationStopTarget(SimulationModel):
    targetId: ControlId
    clock: Annotated[NativeStopClock | DomainStopClock, Field(discriminator="kind")]
    boundary: StopTime
    mode: Literal["at-boundary", "drain-admitted"]
    checkpointPolicy: Literal["none", "request"]
    drainBudget: StopDrainBudget

class SimulationStopCut(SimulationModel):
    nativeRevision: ObservationCount
    nativeTime: StopTime
    clockRevision: ObservationCount
    clockValue: StopTime
    recordedAt: ObservationCount
    tokenBaseline: ObservationCount
    operationCount: ObservationCount
    requestCount: ObservationCount
    decisionCount: ObservationCount
    tokenReservationCount: ObservationCount

class SimulationStopState(SimulationModel):
    revision: ObservationCount
    commandId: ControlId
    target: SimulationStopTarget | None
    nativeBoundary: StopTime | None
    activation: Literal["effective", "pending", "rejected"]
    state: Literal["armed", "draining", "paused", "cleared"]
    reason: Literal["target-reached", "native-boundary-reached", "external-in-flight", "past-boundary", "drain-budget", "cleared"] | None
    cut: SimulationStopCut | None
    steps: ObservationCount
    tokens: ObservationCount
    checkpointAttemptCount: ObservationCount
    checkpointId: ControlId | None
    checkpoint: Literal["not-requested", "pending", "completed", "failed", "external-state-required"]

class SimulationRunControlInput(SimulationModel):
    runId: Identity
    commandId: ControlId
    target: SimulationStopTarget | None

class SimulationRunControlReceipt(SimulationModel):
    commandId: ControlId
    revision: ObservationCount
    activation: Literal["effective", "pending", "rejected"]
    targetId: ControlId | None
