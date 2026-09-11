# Agent Note: Durable Team human actions and provider usage

Status: implemented

English | [中文](2026-08-31-durable-team-interactions-and-usage.zh.md)

## Problem

Approval and question requests were previously host-process waits represented only by mux frames. A restart could leave a Team with no durable indication that a human decision was pending. Team budgets also had configured token, turn, and cost ceilings without a Team-owned usage fact or an idempotent way for Session adapters to report provider accounting.

## Decision

`clocky-team` defines `TeamHumanActionSnapshot` and cursor-fenced `upsertHumanAction()`/`resolveHumanAction()` operations. `team-hub` stores whole `human-action/changed` records in the Team journal, folds them into `TeamStateSnapshot.humanActions`, and keeps request details and terminal outcomes across JSON/SQLite recovery. The source request identity is stable per Team, Session, kind, and provider request id; an existing action is replayed only when its immutable request facts match. Pending actions participate in quiescence diagnostics.

The same journal owns `TeamUsageSample` and `TeamUsageSnapshot`. `recordUsage()` replaces a repeated turn/step sample (for example, an early stream sample followed by the final assistant message) instead of double counting it. The Hub folds token buckets, distinct Session turns, and provider-supplied cost units, validates the aggregate during replay, and durably stalls a Team when its frozen turn, output-token, or cost ceiling is crossed. An explicit provider cost remains authoritative; otherwise a configured creation-time rate table prices the sample, as specified by the [usage admission decision](2026-08-31-team-closure-authority-and-detail-inspection.md).

Typed Team budgets cannot relax creation-time deployment ceilings: both remain binding, and the effective limit is the smaller defined value. `recordUsage()` retains observed consumption before stalling when it exceeds a limit; closure-driver scans stop new work when consumption reaches the same limit. Both sides derive the same observation reason. A zero typed token, turn or cost ceiling is already exhausted, and fractional typed cost units remain valid; integer count and deployment-limit validation is unchanged. Late settled usage remains accountable after a Team stalls. Retry and concurrency limits govern new attempt admission; recovery budget scans do not stop an already admitted final retry or an attempt occupying its concurrency slot.

The Host approval and question adapters persist Team-provenanced requests and terminal outcomes when a Session header supplies Team and Participant identities. The browser Team projection seeds pending actions from the durable Team state and continues to consume live mux requested/resolved frames. A host restart therefore preserves the pending Team record even though an in-flight tool promise cannot be reconstructed by the host alone.

Bound local Agents forward final `assistant/message.usage` events with exact Team/Participant/Session/turn/step provenance. The Team Hub remains the accounting authority; delivery, model execution, and pricing remain provider concerns.

## Alternatives considered

**Keep approvals and questions only in the host mux registry.** Rejected because a Team page and audit consumer would lose the pending decision after Hub restart, even though the originating Team and Session remain durable.

**Accumulate every usage event as a new billable sample.** Rejected because adapters can report an early stream usage sample and a final assistant-message sample for the same turn/step; replacing the sample by its stable id avoids double counting.

**Infer undocumented provider prices.** Rejected because pricing, cache multipliers, and deployment currency belong to the provider route; only explicit sample cost or a configured frozen rate table can supply normalized cost units.

**Let a typed budget override a deployment ceiling.** Rejected because an independently supplied Team budget cannot relax the deployment limit retained at creation. Selecting the tighter defined ceiling preserves both constraints; omitting a typed ceiling leaves the deployment ceiling in force.

## Consequences

Team journal and checkpoint formats are 26 and 27. Existing pre-release streams are rejected rather than guessed into the new projection. Team state consumers may treat `humanActions`, `usage`, and `workflowPlans` as optional when reading hand-built test fixtures, while the Hub emits each applicable field for new durable Teams. Typed Team and task resource budgets cover token, turn, wall-time, retry, concurrency, cost, and provider-extension ceilings; assignment admission checks static reservations and runtime retry/concurrency limits before a lease is committed.

This does not claim host-side promise recovery after a process crash, a universal cost catalog, or automatic multi-host consensus. Those boundaries remain explicit in the native multi-agent work-system note.

## Verification

JSON and SQLite Hub tests cover pending/settled human-action recovery, idempotent action writes, usage replacement, budget stalling, and checkpoint validation. Real closure-driver/Hub tests cover exact typed/deployment limits, zero ceilings, fractional cost, preserved over-budget samples, late accounting after stalling, and an admitted final retry. A headless Loader snapshot verifies actual AgentClient Session usage, tighter-limit and fractional-cost driver stalls, and zero-budget rejection before activation. Host approval/question tests retain their parallel-request behavior. Core, Host, client, and generated Cordis catalogs typecheck and focused Team/Agent-client suites pass.
