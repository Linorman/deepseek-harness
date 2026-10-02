# Agent Note: Atomic task responsibility and conditional fulfillment reconciliation

Status: implemented

English | [中文](2026-09-30-simulation-task-interaction-link.zh.md)

## Problem

A task creation has no interaction identity. Inferring one from task text or completion can fulfill unrelated responsibility. Linking after assignment loses the association on response loss; checking an open commitment only before queued IO allows a cancellation race.

## Decision

`assignTask()` accepts an optional explicit interaction identity. Its producer captures the canonical pending task and interaction revision. Native reserves the original attempt and links the accepted interaction in one journal append, checking the selected assignee, open commitment and original creation receipt. Later attempts preserve the task's association; an ordinary task cannot acquire one retrospectively. Native journal format 43 rejects earlier formats.

Task context records the interaction identity and captured revision with a reference to the reservation record. Both content and source participate in replay validation. Assignment proof resolution rechecks the associated commitment around Hub policy IO; closing responsibility cannot publish a new assignment.

The [completion producer](../../../../packages/simulation/simulation-team/src/task-completion.ts) observes the exact Team result before reconciling newer interaction evidence. It waits for closed windows and required review. Cancelled or fulfilled commitments are not updated. Its conditional reconciliation requires an open commitment again inside the native queue; a race rejects without a partial business reference, while the settled task remains retryable. Only the interaction's immutable `task-completed` policy can fulfill from completed task evidence. Transfer and creditor-approval policies retain their own evidence requirements.

The [task completion decision](2026-09-30-simulation-task-completion.md) remains authoritative for result intent and target settlement. The [product proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md) remains active for automatic selection, production executor and full failure matrices. Neither is fully superseded.

## Alternatives considered

**Guess an interaction from task title or actor identity.** Those values do not identify the accepted business responsibility.

**Link after assignment.** A crash leaves an assigned attempt whose fulfillment choice was never retained.

**Let task completion satisfy every fulfillment policy.** It substitutes execution for independently required delivery or creditor approval.

## Consequences

Ordinary tasks remain independent. Associated task facts, review and commitment phase remain distinct. Original task result retries do not reevaluate cognition or repeat world effects. An association survives interruption and cancellation without reviving a closed commitment. Existing administrative reconciliation can retain closed-task facts; the completion producer uses the stricter open-commitment admission.

## Verification

Native JSON/SQLite tests verify one-append acceptance, exact cold replay, immutable association across attempts and rejected source/assignee changes. Actual Hub lifecycle tests cover three fulfillment policies, cancellation during assignment and queued reconciliation, a competing window and configured review. Real Loader snapshots record linked context, actual input/start, applied inventory transfer and completion under each policy without inference. This evidence does not establish an automatic executor or its full process-exit matrix.
