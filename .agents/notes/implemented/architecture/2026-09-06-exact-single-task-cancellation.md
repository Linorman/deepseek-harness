# Agent Note: Exact single-task cancellation

Status: implemented

English | [中文](2026-09-06-exact-single-task-cancellation.zh.md)

## Problem

A task stop can race assignment, review, lease expiry, reconnection, and Team closure. Changing a task to cancelled before its owner stops can release its execution scope while work still uses it. Cancelling the whole Team also stops unrelated work.

## Decision

The Hub retains one cancellation on the Task snapshot, including the requesting participant, original revision, optional reason, timestamp, and exact pending, review-attempt, or activation-bound attempt target. Repeated requests preserve the first intent and immutable attempt history. New work and review decisions reject once that intent exists.

Pending work settles after any retained allocation releases. Review cancellation closes only the consult for the selected completed attempt, then settles without inventing a review decision. The scheduler resumes interrupted lease-free cleanup from that same durable intent.

Assigned and running tasks retain their phase, lease, and resources until the selected owner acknowledges stopped work or its activation has a real quiescence fact. Lease expiry records the elapsed deadline while termination remains unconfirmed; it cannot reopen the task. Local and WebSocket Links replay the retained intent for the exact activation. The Agent client reconstructs exact task claims from the Session log. It can discard proven queued-only input independently; running work waits for its own `turn/end`, releases the allocation, and acknowledges through its binding. `resumePending` preserves existing waking input without turning injected context into a new turn. Delayed notifications cannot stop subsequent work.

TeamRun and model tools expose bounded cancellation progress; Host and both SDKs retain the same Task facts. The Team stays available for other tasks. Workflow task cancellation validates its retained plan/template binding and reuses the same exact-work stop. The Hub cancels only unstarted same-plan descendants with an unsatisfiable terminal prerequisite, retaining that prerequisite’s id, revision, and phase in `blockedByOutcome`. Retryable failures remain pending. Independent nodes continue; after all bound tasks settle, the Hub records the aggregate plan outcome and only the configured result selection in the same journal batch. A failed task makes the plan failed; otherwise a cancelled task makes it cancelled. Plan completion does not replace owner termination or allocation release. A terminal task is not a termination proof for a live owner.

Task terminal commits also cancel still-pending human actions bound to that task in the same journal batch, with an explicit `task-cancelled` business outcome. Already-settled Host decisions and Session `approval/decided` events remain unchanged.

## Alternatives considered

**Immediate terminal cancellation.** Rejected because task state could claim resource release while its owner still executes.

**Soft participant interruption.** Rejected because it lacks a task-attempt fence and does not prove completion of the stop.

**A separate cancellation registry.** Rejected because it would duplicate durable Task authority.

## Consequences

Cancellation can remain non-terminal after the lease deadline or a failed allocation cleanup. Callers observe the retained intent and task phase instead of treating request acceptance as successful termination. Exact replay requires Link version 5 and the corresponding Task journal and checkpoint formats.

## Verification

Keyless examples exercise an actual filesystem approval wait and an actual participant review, cancellation through model tools, and successful subsequent work in the same Team. Owning tests cover retained deadlines, activation fences, durable replay, old-attempt acknowledgements, and Local/WebSocket reconnect.

Both SDK owning snapshots also preserve a real child's aborted tool turn and its subsequent turn from retained waking input, while the coordinator returns an explicit Team final. TypeScript verifies source and built runtimes; the Python advanced scenario verifies the built workspace runtime, with single-executable validation remaining a release check.
