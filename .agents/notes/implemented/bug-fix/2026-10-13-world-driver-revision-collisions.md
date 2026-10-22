# Agent Note: World driver queue revision collisions

Status: implemented

English | [中文](2026-10-13-world-driver-revision-collisions.zh.md)

## Problem

World scheduling reads Native state before asynchronous Team work and admission to the Native write queue. A real user pause can commit between that read and `openWindow()` admission. The original revision must reject, but classifying this expected concurrency outcome as driver failure prevents a subsequent explicit start and misreports a valid pause. An unrelated provider failure can also arrive while paused, so the current phase alone cannot classify an exception.

## Decision

Native raises the public [SimulationRevisionConflictError](../../../../packages/simulation/simulation/src/revision.ts) with the original expected and actual cursors. Its revision comparison, queue ordering and durable records remain unchanged. The [World driver](../../../../packages/simulation/simulation-world/src/driver.ts) handles only that type: a now-paused run returns paused; a running run returns a bounded coordination limit for fresh evaluation by its existing scheduling owner. No stale window is accepted. Original fair queue tickets, wakes, plan contents and effects remain retained. Explicit start still controls productive scheduling.

Other provider, context, identity and schema exceptions propagate even when another owner has recorded pause. This extends the administrative concurrency contract of the [durable simulation proposal](../../proposed/architecture/2026-09-17-durable-simulation-coordination.md); that proposal remains active because its broader ownership, outbox and unimplemented coordination decisions are independently useful. No active implemented note owns this exact classifier; no note is superseded or archived.

## Alternatives considered

**Ignore the revision.** This accepts inputs whose reviewed snapshot no longer owns admission and bypasses the Native concurrency contract.

**Match exception text or swallow all failures while paused.** This mistakes unrelated failures for successful pause and couples correctness to wording.

**Retry in an unbounded inner loop.** Repeated management can monopolize scheduling. Returning the existing bounded coordination stop retains the caller's batch and queue policy.

## Consequences

A concurrent unrelated write while running causes fresh evaluation in another bounded batch. Paused collisions do not mark the Product owner failed or erase accepted work. The error adds runtime classification without changing journal formats, durable source evidence or the Session protocol.

## Verification

[Driver tests](../../../../packages/simulation/simulation-world/tests/driver-revision.spec.ts) use real JSON/SQLite Native queues, exact cursor conflicts, retained future wakes and zero model dispatch. They also require an unrelated IO failure to propagate after recorded pause. The [browser test](../../../../apps/web/tests/world-director-events-authoring.snapshot.ts) retains the original author/preflight/create/start flow and a fixed admission barrier after a real scenario commit: actual UI pause wins, the original `openWindow()` call rejects, scheduling drains without further inference, and the actual HTTP control view remains paused with a healthy driver. The original intermittent failure and its stack remain in the completion evidence.
