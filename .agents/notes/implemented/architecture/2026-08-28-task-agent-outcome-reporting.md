# Agent Note: Task Agent outcome reporting

Status: implemented

English | [中文](2026-08-28-task-agent-outcome-reporting.zh.md)

## Problem

A task-assignment delivery starts a lease-backed attempt and records model-visible instructions, but the running Agent needs a safe way to report its result. Letting a model tool call the Hub with freely supplied Team, Participant, activation, or phase values would let a stale or unrelated Agent construct an owner-looking request. Retrying after a successful Hub settlement can also produce a tool error when the response or Session result write is lost, despite the immutable attempt outcome already being durable.

## Decision

`@clocky/clocky-tool-team` installs `team_task_report` only in an Agent scope whose Session header names a Team and Participant. The tool accepts task id, attempt id, and one worker-owned outcome: completed with a summary, failed with a code and message, or released. It parses exactly one durable `team-task-assignment` `user/message` source, requires its Team, task, attempt, activation, wake channel, and post-start `runningRevision` to match the current running lease, and verifies the activation binding to the calling Session and Participant.

With local Team authority, the tool retains its short-lived configured `TeamLink`. A remote child borrows only its exact Agent-owned fixed Link through an owner-scoped callback; it cannot read a credential or open another connection. `settleTaskAttempt()` derives Team, Participant, and activation facts from that Link binding before the Hub applies its owner fence and `task-mutate` policy. The model cannot supply a revision, recipient, activation, Session, next phase, review decision, cancellation, or lease-expiry outcome. The Hub continues to map completed work to review and released or failed work to retry or terminal failure under the task's frozen attempt limit.

Before settlement and after a Link settlement failure, the tool checks immutable attempt history. The Hub also returns the original task snapshot for a retry with the same binding, attempt, and outcome; a different result, expired attempt, or replaced lease rejects. Normal `tool/call` and `tool/result` records retain the requested report and returned task state, so no new Session event is needed.

## Alternatives considered

**Call `ctx.teams.settleTaskAttempt()` directly from the model tool.** Rejected because the tool would need to reconstruct and supply owner identity fields, while a remote Link would need a parallel authentication path.

**Put the model tool in `team-agent-client`.** Rejected because inbox admission and model controls have different ownership and future remote clients need the same report behavior without inheriting local delivery state.

**Let the model select task phase or resolve review.** Rejected because result reporting and durable review/retry policy are separate Hub decisions.

## Consequences

The [durable task attempts and leases decision](2026-08-28-durable-task-attempt-leases.md) remains the authority for task outcomes, phase mapping, fences, and replay validation. The [Team Link registry decision](2026-08-28-team-link-registry.md) remains the authority for activation-bound transport identity. Both records remain active after the scoped archive audit: they retain independently useful durable and transport boundaries, while this note owns only the model-report path.

The `team_task_report` operation does not route reviewers, allocate workspaces, or complete a Team. The same scoped package exposes separate activation-bound operations for renewing a lease, executing a durable integration task, resolving a review assignment, and posting an explicit channel message; each derives its own operation identity and keeps caller-supplied authority out of the model arguments. A completed report with a workspace allocation still crosses the provider's explicit report-only publish boundary before settlement. It requires an Agent Client to have durably admitted a task-assignment source first. Remote workers use these borrowed-Link paths; remote coordinators use the separate borrowed-Link `team_final` path.

## Verification

`tool-team` tests cover scoped registration and disposal, exact source/binding/lease checks, every worker outcome, heartbeat renewal and recovery, integration provenance and result projection, review response ordering, explicit message audience and retry identity, invalid inputs, stale identities, replay after lost responses, conflicting reports, workspace publication, operation-specific presentation, and Link close failure containment. Real local and SDK-child compositions deliver an assignment before the scoped tool reports its exact running attempt.
