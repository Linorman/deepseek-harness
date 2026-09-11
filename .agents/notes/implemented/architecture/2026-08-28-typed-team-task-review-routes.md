# Agent Note: Typed Team task review routes

Status: implemented

English | [中文](2026-08-28-typed-team-task-review-routes.zh.md)

## Problem

A task's prior `reviewPolicy` was an uninterpreted JSON object. Every successful attempt entered `review`, and any active participant could resolve it without a durable explanation. That made no-review work take an unnecessary state transition and made a future reviewer router unable to prove who was selected or why accepted work returned for rework.

## Decision

`TeamTaskReviewPolicy` is a closed task-creation value: `{ kind: 'none' }` or `{ kind: 'participant', reviewerId }`. A completed attempt under `none` reaches `completed` directly. A participant route reaches `review`; only the exact active configured reviewer may resolve it through `resolveTaskReview()`.

Every resolution appends an immutable `TeamTaskReviewDecision` to the task snapshot. It identifies the completed attempt, reviewer, accepted `completed` or rework `pending` phase, nonempty reason, and decision time. The Hub validates the policy and decision history during journal fold and checkpoint recovery, retains prior decisions across rework, and rejects a missing, duplicate, out-of-order, wrong-reviewer, or unresolved completed attempt.

The task report tool remains owner-fenced and only reports the attempt result. It now returns a direct `completed` phase for a no-review task and `review` for a participant-routed task. Review routing, review-channel delivery, and a model-facing review action remain separate Consumers. This snapshot change advances the Team journal to format 7 and the Team checkpoint to format 8; older Team formats are rejected.

## Alternatives considered

**Keep `reviewPolicy` as arbitrary JSON.** Rejected because the Hub could not validate reviewer identity or determine whether a completed task needed review without provider-specific unchecked keys.

**Let any active participant resolve a review.** Rejected because it allows a worker or unrelated teammate to approve work and leaves no durable reviewer selection for recovery or audit.

**Create a separate reviewer task before defining the route.** Deferred because task-assignment channels start worker attempts and cannot safely stand in for reviewer delivery. The typed route and decision history establish the durable facts that a later review Consumer will consume.

## Consequences

Callers must choose an explicit no-review or participant-review route when creating a Team task, and a review resolution must supply a reason. Rework returns the same task to `pending`, so the existing scheduler and retry fence mint its next attempt without a second retry mechanism. A task awaiting review cannot be cancelled or deleted because that would discard its unresolved completed attempt, and a participant-reviewed attempt cannot enter review after its configured reviewer leaves or fails. A later routing or stall Consumer owns recovery from a reviewer that becomes unavailable after the task already enters review. The [durable task-attempt decision](2026-08-28-durable-task-attempt-leases.md) remains the authority for attempt ownership; the [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) still owns reviewer routing, stall, quiescence, and Team completion.

## Verification

The [scheduler composition](../../../../packages/team/team-scheduler-dag/tests/composition.spec.ts) uses the real Hub, consult adapter, directed view provider, and scheduler to open a review channel for a completed worker attempt. The request retains the exact reviewer, attempt, revision, and result. An authorized response completes an accepted task or reassigns a rework task with a new attempt; both paths preserve the completed attempt and one review decision without duplicating the consult channel.

Core schemas reject invalid routes, history, reason, and lifecycle combinations. Hub tests cover no-review direct completion, exact reviewer enforcement, accepted and rework decisions, attempt-two reassignment, malformed journal/checkpoint decisions, and restart recovery. The Team task-report composition proves the returned phase follows the frozen route.
