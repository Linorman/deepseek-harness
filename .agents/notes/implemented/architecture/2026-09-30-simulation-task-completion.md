# Agent Note: Evidence-backed Simulation task settlement

Status: implemented

English | [中文](2026-09-30-simulation-task-completion.zh.md)

## Problem

Task-model submission retains proposed world operations. Completing its Team attempt at submission can report success before inventory changes or recipient persistence, and response loss can repeat inference or select a different result.

## Decision

An effect-owned, versioned scenario policy evaluates detached frozen world and original-attempt views synchronously, without IO. The [completion producer](../../../../packages/simulation/simulation-team/src/task-completion.ts) pins its generation and waits for an idle actor. Native records immutable result intent before Team settlement. For ordinary results, Native independently requires applied operations from accepted decisions with this attempt's recorded input and epoch; communication also requires recipient persistence. Completed results require nonempty evidence. Policy-owned outcomes exclude scheduler release and lease expiry. Native journal format 46 rejects earlier formats.

The runtime-only settlement proof binds the accepted result, original creation, exact attempt and live writer epoch. The Hub rechecks that proof around policy IO and preserves ordinary review, result, budget and cancellation semantics. A target receipt is separate from Native result intent. Exact retries reuse accepted intent after policy removal or response loss without repeating computation, inference or world effects. A conflicting original terminal outcome remains an interruption; connection retirement cannot turn its intent into a completed receipt.

The [bounded task executor](../../../../packages/simulation/simulation-product/src/task-executor.ts) selects accepted creation receipts by trusted source-entity and optional exact-operation routes. It owns one coalesced serial batch over canonical reads, residency, stable attempt reservation, recorded input, scoped cognition, due effects and completion. Route, cognition and completion generations are checked on retry. The resolved `retry` policy rejects automatic replacement by default, permits pre-effect replacement after physical retirement, or invokes the installed pure scene recovery function over frozen reconciled facts. Cancellation and remaining attempts remain authoritative.

For a fulfilled transfer, Native admits `continuation` only when every commitment witness belongs to earlier physically retired attempts of the same task, assignee and canonical Session. New input and an accepted empty acknowledgement use the fresh epoch; new world proposals reject. Completion retains the original operation witnesses after independently verifying that acknowledgement. The closed interaction/commitment and failed old attempt remain unchanged. This prevents an unknown result from causing another inventory transfer while still allowing the original task to complete. The [company driver](../../../../packages/simulation/simulation-product/src/company-driver.ts) supplies the finite scene policy, configured product timer and future-effect advancement.

The [cognition decision](2026-09-30-simulation-task-cognition.md) remains authoritative for task input and start. The [product proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md) remains active for the complete product acceptance matrix and additional task scenes. Both are partially extended, not fully superseded.

For a delivered report, `reportContinuation` selects the original retired attempt, creation operation and prepared-context fingerprint. Native validates the same run, task, executor, participant and Session, an older epoch, the latest retired predecessor, the accepted report decision and exact durable recipient receipt. An interrupted acknowledgement may point back to the same original report; a fresh rework attempt cannot borrow a historical completion. The selector is recorded in required task input using the existing context/session events. A fresh accepted empty acknowledgement consumes the original report as completion evidence without publishing again. Session format remains `0`; native journal format `46` records these task relationships and rejects prior storage formats.

Task cognition opens an exact single-slot ordered window before execution. Pause retains submitted proposals; cold restoration cancels them only after physical writer retirement. Cancellation persists canonical intent and a native task fence before stopping an actor or awaiting accepted work. Input, new model-token admission, unaccepted window proposals and fresh completion reject after that fence. Previously accepted effects retain their original identities and remain reconcilable; cancellation does not roll back publication or resource transfers. Checkpoint collection drains both cancellation and report delivery before publishing every actor/channel responsibility.

## Alternatives considered

**Complete on submission or publication.** Neither proves applied world effects or recipient Session persistence.

**Reevaluate policy after a lost settlement response.** A replacement policy or later world state can change the original terminal intent.

**Treat result intent as fulfillment.** Review and interaction policies own separate evidence; a transfer-policy commitment cannot be fulfilled by task completion alone.

## Consequences

Scene policies select completion evidence, while Native validates its provenance. Administrative result acceptance makes no model request or context change. An accepted intent may survive target interruption without claiming successful execution. The [interaction-link decision](2026-09-30-simulation-task-interaction-link.md) owns explicit association and conditional fulfillment reconciliation. Transfer and delivered-report recovery are supported; other effect shapes require their own source-backed continuation rules.

Prompt instructions or a completion policy alone cannot authorize report recovery: a replacement model could republish, and a stale policy could select unrelated historical evidence. Native admission and result folding therefore independently validate the recorded selector. An unsupported or mismatched report stops explicitly rather than selecting a new effect.

## Verification

Real source and built-lib JSON/SQLite Loader scenarios submit inventory transfer through the actual restricted model tools, wait before application, apply the transfer, settle the original attempt and reconcile its lost response after policy removal. The automatic executor scenario selects and completes the task through production methods with model/deterministic cognition and a lost settlement response. Native tests reject unpublished, unapplied, unrelated and recipient-unconfirmed evidence and retain result intent across cold replay. Lifecycle tests cover busy actors, pinned generations, coalesced calls, conflicting terminal outcomes and close-time retirement. The real product task composition verifies model/deterministic cognition, background scheduling, complete checkpoints and nine cross-owner process-exit points on JSON/SQLite. Direct production-path tests reject repeated continuation proposals and substituted result witnesses. These checks do not establish all additional-scene or browser failure/recovery matrices.

The [three-actor process matrix](../../../../examples/simulation-company/tests/task-workflow-fault.snapshot.ts) records and replays 22 real Loader/scheduler/executor cases across JSON/SQLite, including submitted windows, delivered reports, result acceptance and reconciliation. [Report recovery](../../../../packages/simulation/simulation-product/tests/report-continuation.spec.ts), [cancellation](../../../../packages/simulation/simulation-product/tests/task-cancellation.spec.ts), [concurrent collection](../../../../packages/simulation/simulation-product/tests/execution-checkpoint-concurrency.spec.ts) and [rework fencing](../../../../packages/simulation/simulation-product/tests/report-rework-fencing.spec.ts) cover exact-source rejection, physical retirement and immutable old results. The TS and Python SDK compositions inspect the recorded recovery input across real server restart; distinct explicit/transfer/task-completed compositions verify fulfillment authority. The [execution acceptance record](../../../../design/webui-team-simulation-2026-09-28/acceptance-simulation-execution.md) retains current browser verification and remaining scope.
