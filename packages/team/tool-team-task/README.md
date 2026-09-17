# @clocky/clocky-tool-team-task

English | [中文](README.zh.md)

`@clocky/clocky-tool-team-task` registers default task tools and declarative workflow tools only in the scoped Agent of a live default [`TeamRun`](../team-run/README.md) coordinator. It obtains an opaque coordinator capability from `ctx.teamRuns`; TeamRun revalidates that capability, the live Agent, and its activation whenever an operation runs. Other Team-bound Agents and ordinary Sessions receive none of these tools.

A reviewer failure is an actionable wait error, not an implicit worker failure or review decision. Correct the reviewer or use explicit cancellation before scheduling replacement work. Completed task evidence remains available even when unrelated Team work stalls.

## Operations

`team_worker_pool_set(worker_count)` resizes the worker pool within the deployment limit and returns requested, target, active, idle, busy, queued, and saturation counts. Busy workers finish their work; ready tasks may queue. The coordinator prompt owns delegation policy.

`team_task_start(subject, instructions, read_scopes?, write_scopes?)` admits a bounded worker task with a self-contained brief, deliverable, and validation. Use narrow non-overlapping paths for concurrent writers; tasks without filesystem work leave scopes empty. Absolute paths inside the coordinator workspace become relative paths; outside paths reject. The result returns `task_id`, `phase`, and review facts. Delegation should save time or context and produce independently verifiable work.

`team_task_wait(task_id)` waits for a task admitted through the same coordinator capability, including configured review. Completed results retain `summary`, `evidence`, `artifacts`, `changed_paths`, `verification`, and `integration` when present. Failed results always name `outcome` as `failed`, `released`, or `lease-expired`, with the original failure code/message when available. The existing tool spill policy owns oversized rendered output and retains its readable full-value locator. Cancelling this call stops only the wait. Worker transcripts and lease internals are not included.

`team_task_list()` returns the current compact phase for every non-workflow task created through this coordinator capability. `team_task_watch(after_cursor?)` waits for a Team cursor advance and returns the same bounded task snapshot with the new cursor; cancelling the call stops only this local watch. These operations expose phase and review facts without worker transcripts or lease progress. The first watch omits `after_cursor` for an immediate snapshot; later watches use the cursor returned by watch, not list.

Start, list, watch, and wait return `review_policy`: `{ kind: 'none' }` or `{ kind: 'participant', reviewer_id }`. Their `review_result` is `{ attempt_id, decision: 'accepted' | 'rework' }` for the active attempt, or the latest settled attempt if none is active. `null` means no review decision exists for that selected attempt; it does not mean no reviewer is configured. A new attempt never inherits an older attempt's decision. Review reasons and the full history are excluded.


`team_task_propose_owner(task_id, participant_id?)` sets or clears a durable scheduler hint for an owned pending task. The named Participant receives no authority or lease from the proposal; the scheduler may select another eligible Participant.

`team_workflow_start(plan)` admits one complete JSON-serializable `TeamWorkflowPlan`. Each task template uses the same workspace-relative scope rule as `team_task_start`: an absolute path under the coordinator's current workspace is converted, and an outside path is rejected before admission. The plan contains explicit task templates and plan-local dependencies, bounded concurrency/attempt limits, a role-based versioned workflow channel graph, and a task-result projection. TeamRun validates the complete graph before creating any durable task or workflow channel, and returns a stable `plan_id`. Its model-visible schema defines every nested task, bounds, channel, and result field and includes a runnable two-stage example. `channel.viewPolicy` is required. Choose the worker capability from the coordinator prompt; example scopes show an explicit file handoff between dependent tasks.

`team_workflow_task_cancel(plan_id, task_template_id, reason?)` stops one owned workflow task. Unsatisfiable unstarted descendants cancel; independent nodes continue. `team_workflow_wait(plan_id)` waits for all bound tasks and returns the aggregate plan phase with the selected terminal task facts. Its result is derived from durable task attempts; cancelling this call does not cancel the plan.

## Retry and authority

`team_worker_pool_set` and `team_task_start` are coordinator-only. Concurrent task admissions serialize only the short pool/topology and task-creation section, so automatic scale-up sees every outstanding task while already admitted worker tasks continue in parallel. `team_task_start` derives its Team task-create idempotency key from its `rootCallId` and `callId`. A replay of the same model-call lineage reaches TeamRun with the same durable key. TeamRun owns task creation, worker activation, scheduler dispatch, access checks, and terminal state; this package does not expose direct Team, worker, or lease authority.

`team_workflow_start` derives its plan-admission key from the same complete call lineage. The Hub stores the plan, channel binding, task bindings, and terminal projection in the Team journal, so a retry or restart resumes compilation without replaying model-written code.

## Configuration

This package has no configuration. Its capability is available only when a composition mounts `team-run`, `agents`, and `tools`, then creates a current default coordinator.

## Single-task cancellation

`team_task_cancel(task_id, reason?)` requests a stop while other Team tasks continue. A non-terminal response means owner or allocation cleanup is pending; `team_task_wait` observes settlement. Start/list/watch/wait/cancel results expose bounded `cancellation` facts, with null for no single-task intent. [Cancellation ownership](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.md).

## Model Experience

### Worker-pool sizing

#### What the model sees

The coordinator-only [`team_worker_pool_set`](../../../docs/tool-catalog.md#clockyclocky-tool-team-task) schema accepts a desired worker count and returns bounded target, active, idle, busy, queued, and saturation facts. It is safe to call before task fan-out or while work is running.

#### Token effect

One stable coordinator-scoped schema and one compact status result.

#### KV Cache effect

The schema is stable for the coordinator; pool counts are dynamic suffix entries.

### Default-worker task start

#### What the model sees

The scoped [`team_task_start`](../../../docs/tool-catalog.md#team_task_start) schema, followed by a compact `task_id`, `phase`, `review_policy`, and `review_result`. Normal `tool/call` and `tool/result` events retain the request and result; this package adds no Session event.

#### Token effect

One coordinator-scoped schema and one compact result per task start. No other Agent receives the schema.

#### KV Cache effect

The schema stays stable for the current coordinator scope. Each request and result is a dynamic suffix entry.

### Default-worker task wait

#### What the model sees

The scoped [`team_task_wait`](../../../docs/tool-catalog.md#team_task_wait) schema returns terminal phase, complete retained work evidence, and the exact failed outcome. It includes review policy and the selected attempt decision; it excludes worker transcripts and lease internals.

#### Token effect

One coordinator-scoped schema and the retained result fields per completed wait. Evidence size determines the dynamic token cost; the mounted tool spill policy bounds the rendered preview and retains the complete result. No other Agent receives this schema.

#### KV Cache effect

The schema stays stable for the current coordinator scope. Terminal results are dynamic suffix entries.

### Default-worker task inspection and cancellation

#### What the model sees

The scoped [`team_task_list`](../../../docs/tool-catalog.md#team_task_list), [`team_task_watch`](../../../docs/tool-catalog.md#team_task_watch), [`team_task_cancel`](../../../docs/tool-catalog.md#team_task_cancel), and [`team_task_propose_owner`](../../../docs/tool-catalog.md#team_task_propose_owner) schemas. List/watch return owned `task_id`, `phase`, `review_policy`, and `review_result` values plus the durable Team cursor for watch. Cancel returns the owned task's resulting phase; owner proposal returns the retained hint without granting assignment authority.

#### Token effect

One compact phase snapshot can cover all currently owned non-workflow tasks. Watch results are dynamic suffix entries and do not repeat worker context.

#### KV Cache effect

The schemas are stable for the coordinator scope; task phases, cursors, cancellation results, and owner proposals remain dynamic.

### Declarative workflow plan

#### What the model sees

The scoped [`team_workflow_start`](../../../docs/tool-catalog.md#team_workflow_start) schema accepts data only: task templates, dependencies, bounds, a role-based transition graph, and result selection. The compact response contains a `plan_id` and durable phase. `team_workflow_wait` returns only the selected task results.

#### Token effect

One workflow-plan schema and one compact plan result are added to the coordinator's request stream. The plan and terminal task facts remain dynamic.

#### KV Cache effect

The schemas are stable for the coordinator scope; each plan and result is a dynamic suffix entry.

## Known Limitations and Deferred Work

- **Default worker pool profile** — the shipped compiler resolves tasks to its configured local worker pool and shared workspace; general roster selection and task-specific placement remain separate Consumer work.
- **Compact task monitoring** — list/watch expose durable phase, review, and cursor facts, not percentage progress, worker transcript, lease internals, or task-specific placement.
- **Advisory owner proposals** — a proposal can prefer a Participant, but it never bypasses scheduler eligibility or transfers task authority.
- **Workflow channel role resolution is local** — plan roles must resolve to one active default coordinator, worker, or configured reviewer Participant; remote and custom placement remain explicit composition work.
