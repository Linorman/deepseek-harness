# Agent Note: Native Simulation task review authority

Status: implemented

English | [中文](2026-10-01-simulation-task-review-authority.zh.md)

## Problem

Simulation task results can require acceptance or rework while their reviewer is dormant. Generic activation or human mutation authority would let callers choose an unrelated reviewer or bypass the native completed-result owner. An accepted review whose response is lost must remain attached to its original attempt when a later attempt runs.

## Decision

The [Simulation connection](../../../../packages/simulation/simulation-team/src/task-review.ts) derives its Team, task/create operation, creator and executor from the native reserved attempt and applied creation receipt. Its reviewer is the active native entity whose binding matches the frozen participant review policy. Review requires an immutable native completed result, but no resident reviewer, writer epoch or model inference. Running and paused runs admit it; checkpoint collection, close and service unload retire the connection's authority. A caller may supply an admission lease check that runs at entry, within proof validation and after awaited owner operations.

An opaque, nonserializable, short-lived proof selects only `simulation-task-review`. Its resolver rechecks the original source and bindings every time the [Hub](../../../../packages/team/team-hub/src/index.ts) validates it. `resolveSimulationTaskReview()` uses the Team serializer and checks canonical creation, result, configured reviewer, selected revision, latest completed attempt, cancellation and absence of a lease before and after ordinary task-mutate policy IO. The scheduler's consult-response recovery stays a separate operation and rejects Simulation scopes.

Each accepted review retains `TeamTaskReviewDecision.simulationCommand`: run id, run-wide command id, original task/create operation and selected revision. The decision's existing fields retain reviewer, attempt, phase and reason. Reusing that run-wide identity with another task or payload rejects. An identical command with live authority returns the current canonical task retaining its historical review without another policy invocation or mutation. It never reviews a subsequent attempt. Native observes only returned facts still belonging to the original attempt; a historical retry skips later-attempt observations. Team journal and checkpoint format 40 rejects earlier formats; Native journal structure is unchanged.

## Alternatives considered

**Activate the reviewer.** Activation adds capacity and recovery dependencies to a deterministic administrative decision and does not establish native result ownership.

**Reuse scheduler review recovery.** Its authority derives from two durable consult Envelopes and a channel lock; Simulation derives from native creation, result and entity binding.

**Keep review retries only in memory or the product journal.** Target acceptance can outlive that caller and a later attempt. Durable Team attribution establishes the original decision at the mutation owner.

## Consequences

Participant review policy and ordinary task semantics remain authoritative. The new connection method is an administrative capability outside model tools and ordinary human Team mutation routes. Consumers identify a retried command's original outcome from its retained review decision rather than the task's current phase. The [completion decision](2026-09-30-simulation-task-completion.md) continues to own result acceptance; scenario selection and Web orchestration remain product-owned.

## Verification

[Native review tests](../../../../packages/simulation/simulation-team/tests/task-review.spec.ts) exercise JSON and SQLite, paused review with a physically stopped reviewer, exact retries, conflicting payloads, rework followed by another reviewed attempt, missing native result or source, changed reviewer binding, inactive phase, stale revision, checkpoint and close admission including pending policy IO, reviewer or caller lease withdrawal during owner reads or policy IO and proof revocation/nonserialization. Serialized projection replay preserves command attribution and rejects a different creation or future revision. Core runtime and Hub edge-case regressions preserve ordinary reviewer and scheduler recovery behavior. These tests establish the administrative authority and idempotency contract; product composition and browser verification remain with their owning workflow.
