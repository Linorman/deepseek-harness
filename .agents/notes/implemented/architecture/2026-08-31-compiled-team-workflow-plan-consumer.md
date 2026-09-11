# Agent Note: Compiled Team workflow-plan Consumer

Status: implemented

English | [中文](2026-08-31-compiled-team-workflow-plan-consumer.zh.md)

## Problem

The retained workflow package could execute model-written JavaScript, but a shipped Team workflow needs a durable graph whose admission, task fan-out, channel protocol, result projection, and restart behavior do not depend on private script state. Without that boundary, a coordinator could create tasks incrementally before the whole graph was checked, and a restart could neither distinguish an incomplete compilation from a new request nor safely retry an opened channel.

## Decision

`clocky-team` owns a version-one, JSON-only `TeamWorkflowPlan`. It contains complete task templates with plan-local dependencies, typed task bounds, a result selection, and a role-based workflow-channel graph with built-in conditions/targets or exact versioned extension references. The core validator rejects duplicate or unknown template ids, dependency cycles, invalid bounds, unknown result references, invalid role targets, and unbounded graph syntax before durable admission.

`TeamRuntime` providers expose plan admission, reads, task/channel binding, and phase transition operations. The local Hub stores each whole plan revision as `workflow-plan/changed` in the Team journal, together with task/template provenance and a plan-owned channel id. The [Hub README](../../../../packages/team/team-hub/README.md) owns current durable format versions. Plan and channel retries use the durable plan identity; a matching workflow channel open returns its existing manifest rather than minting another channel. Task snapshots also retain an advisory `proposedOwnerId` hint under the same journal format; the hint is revision-fenced and does not change authority.

`TeamRunService` is the shipped compiler Consumer. Its coordinator-scoped `team_workflow_start` tool accepts only plan data. The Consumer resolves declared roles to one active default coordinator, the configured local worker pool, or a configured reviewer, validates exact workflow extensions, opens or recovers the workflow channel, creates tasks in deterministic topological order, binds each task with a stable plan/template key, and transitions the plan to `ready` only after every binding exists. `team_workflow_wait` reads the Hub-owned aggregate outcome after every bound task settles, including its selected terminal task results. The same coordinator scope now exposes compact task list/watch/cancel operations for non-workflow tasks and an advisory owner-proposal operation; watch carries the Team cursor, cancellation follows the [exact task-stop protocol](2026-09-06-exact-single-task-cancellation.md), and a proposal never transfers authority. The scheduler ignores tasks while a plan is compiling, enforces the plan's parallelism and total-attempt bounds, and schedules later ready tasks after its own bounded assignment mutation.

The existing script-driven workflow capability remains available only to explicit custom compositions. It does not share the shipped Team workflow tool name or mutate shipped Team authority. The shipped default-task tool additionally exposes `team_task_propose_owner`; its Participant id is a scheduler preference only, never an assignment or access grant.

## Alternatives considered

**Keep model-written JavaScript as the shipped Team authority.** Rejected because arbitrary control flow, clock access, and private mutable state cannot be replayed as a durable task/channel graph. The script seam remains useful for explicitly trusted custom compositions.

**Create tasks before validating the complete plan.** Rejected because a partial graph can leak executable work, reserve budget, or race the scheduler before a later validation failure. Admission validates the whole plan first, and compiling tasks remain unschedulable until the ready revision.

**Use only a process-local idempotency map.** Rejected because process unload or Hub restart would duplicate tasks or channels. The plan snapshot, task provenance, channel plan id, and compare-and-set revisions are authoritative; in-process maps only coalesce concurrent callers.

**Put concrete participant ids in the model-authored graph.** Rejected because ids are Hub-owned opaque values and are not stable model vocabulary. Plans name Team roles; the compiler resolves one active participant per role, then materializes the adapter's concrete graph.

## Consequences

Shipped coordinators can express bounded fan-out/fan-in work and conditional workflow conversations across a configured local worker pool without a second model loop or unlogged script authority, while retaining a compact view, advisory owner preference, and exact cancellation path for independently created tasks. Durable bindings make a crash between admission, channel creation, task creation, and phase transition recoverable and make retries safe across a new coordinator activation. The scheduler gains a durable readiness gate, plan-local concurrency accounting, and a coalesced follow-up drive after its own assignment.

The first compiler is intentionally local and default-worker oriented: all task templates must be executable by the configured worker and use the shared workspace, while reviewer roles resolve through the configured local reviewer. General participant placement, remote workflow compilation, retention, and multi-host evidence remain deployment work under the [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md).

## Testing

Core workflow tests exercise semantic rejection through both the typed validator and JSON schema, including empty or duplicate collections, self/unknown dependencies, cycles, normalized text, role and reviewer references, attempt overflow, and graph bounds. Every built-in condition and target, versioned extension, and source-ordered fan-in is covered. Unknown JSON condition and target kinds are rejected before semantic validation; only the corresponding closed-union exhaustive assertions and their helper are excluded from runtime coverage. The synchronous topological traversal retains every validated task and dependency in its private maps, so missing-entry branches have no producer.

Task schema tests cover optional owner hints. Hub tests cover JSON and SQLite admission, binding, channel idempotency, checkpoint/restart reconstruction, workflow-owned task provenance, owner-proposal CAS, and malformed owner references. TeamRun tests cover the assembled compiler, result projection, scheduler concurrency race, terminal wait, compact task list/watch, pending cancellation, owner-proposal forwarding, and the configured worker pool. Scheduler tests cover a valid proposal preference, fallback when the proposed Participant lacks a required capability, fan-out across two eligible workers with a blocked fan-in task, and follow-up scheduling after a self-committed assignment. Tool tests cover coordinator-only registration and model-facing field mapping. Keyless assembled Headless snapshots cover the shipped workflow tools through real Team task assignment/report, configured multi-worker workflow fan-out, and a custom owner-proposal/cancellation path with the Team journal, workflow channel WAL, coordinator/worker Session records, and final output checks. Property/model-based, keyed real-model, remote/multi-host, real-browser/GIF, and load/retention evidence remain explicitly pending in the proposal.
