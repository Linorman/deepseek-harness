# Agent Note: Deterministic Team DAG scheduler

Status: implemented

English | [中文](2026-08-28-deterministic-team-dag-scheduler.zh.md)

## Problem

Durable task attempts make assignment safe, but they do not choose an owner, expire a forgotten lease, or prevent two ready shared-work tasks from claiming overlapping declared write scopes. Letting a model, an Agent client, or a process-local timer choose these actions would bypass the Team provider's compare-and-set and policy authority, and would not recover consistently after restart.

## Decision

An explicitly mounted placement Consumer prepares routed active participants before assignment. Task placement restrictions are durable; the Hub checks their ids, roles, runtime providers, and actual activation model/preset selection again when assigning an attempt. Descriptor hints cannot substitute for an activation’s retained selection. The activation controller owns duplicate starts and releases a published residency when its requesting work disappears.

`clocky-team-scheduler-dag` is one concrete Consumer of `ctx.teams`, not a new generic scheduler registry. It reads durable Team projections, calls `openChannel()`, `assignTask()`, `postChannelEnvelope()`, and `expireTaskAttempt()`, and uses the task-assignment adapter's pure parsers. It imports no Hub implementation, Agent, Session, Link, or Agent inbox code. Every public mutation remains a Team provider compare-and-set operation.

One drive checks frozen consumption/time ceilings, expires due leases, then selects ready tasks in descending priority and first durable task-record order. Its initial eligibility set contains active local or remote agents with one exact idle activation, every required capability, available load, and no overlapping shared-work write scope. Ranking uses the Team’s frozen `outcome-latency` v1 policy: proposal, capability surplus, load, completed minus adverse attempts for the same required-capability set, median latency bucket, verified frozen cost-rate bucket when cost-constrained, then Participant id. Missing history is neutral; unknown cost sorts after known rates. Only the binding’s recovery model route proves a rate selection; mutable hints do not. The Hub incrementally folds fixed-size histograms from actual settled attempts and validates checkpoints against retained histories, including deleted-task tombstones. Dependency cancellation without an attempt contributes no failure. The scheduler rereads durable Team state after every accepted mutation or recoverable CAS race. Hub policy and validation remain the final authority.

For each selected activation, the scheduler opens one active `task-assignment` v1 channel with a sole `assignee` and immutable task/activation/Session limits, then assigns the lease with that channel as `wakeChannelId`. It appends the one self-addressed assignment Envelope after the lease exposes its attempt id and assigned revision. A later bounded drive reads every assigned wake channel in rotation through configured `readChannelPage()` continuations, accepts its one parser-validated Envelope, or appends it when a crash left the channel empty. Review request/response repair uses the same page source. It never calls an Agent, Link, or inbox method.

All limits are validated configuration: lease duration, assignment/expiry/wake-dispatch/conflict caps, channel recovery page size, per-Participant load, permitted workspace modes, and disposal bound. Shared work is always enabled; other workspace modes require an explicit opt-in and a provider that accepts the selected task and activation. Startup and committed Team changes request a drive. Deployments can configure `pulseIntervalMs` or supply their own recurring drive for expiry and retention. A post-WAL `team-scheduler/assigned` observation is advisory and contained; restart recovery scans durable assigned tasks and channel WALs rather than relying on that event.

A Team is not unassignable while a task attempt is assigned/running or a participant-review task has an active reviewer's idle/running activation. Such work can unblock later dependencies, so the scheduler resets its unassignable-drive count until that work settles. If no progress remains, a missing reviewer is reported as an owner-eligibility failure; a pending task behind an unsatisfiable dependency is reported as a dependency deadlock. A reviewer becoming busy after a durable consult request does not make that review deadlocked.

Terminal retention uses each channel's reported `firstCursor` to skip already-removed prefixes. Eligible channels consume the drive budget before a terminal Team journal, so repeated journal maintenance cannot prevent channel progress when the budget is one. Active, stalled, and quiescing Team journals are not compaction candidates, while their terminal channels may be. Provider cursor, checkpoint, causation, and pending-delivery checks still govern every selected prefix.

Review requests belong to one completed task attempt. Channel lookup matches that attempt id in the dedicated review payload, so a rework decision cannot make its old channel stand in for a later review. When rework becomes pending before the worker finishes its reporting turn, a capable, workspace-eligible running owner counts as temporary unavailability. The next idle status can then trigger assignment without requiring a manual Team resume. The scheduler checks disposal after the awaited workspace query before any new mutation.

Frozen token, turn, cost and wall-time ceilings use the smaller valid typed or deployment value. Typed counts and time allow zero; typed cost allows nonnegative fractions. Reaching these allowances stops new scheduling. Wall-time admission in the Hub uses the same exclusive deadline: work is rejected at equality, including zero time at creation.

Concurrency and retries govern assignment admission. Full positive Team concurrency leaves admitted work active and resets earlier unassignable-drive observations; zero concurrency stalls ready pending work explicitly. The scheduler checks capacity after expiry, wake repair and review handling, and the Hub rechecks it before a lease commits.

Team retry usage is the sum of each task's attempts after its first. Both the typed and frozen legacy quota constrain only a candidate with an existing attempt. Selection skips quota-blocked retries and continues to first attempts; admitted leases and current reviews finish before an exhausted-retry diagnosis. When no budget-admissible ready task remains, the scheduler records `TEAM_RETRIES_BUDGET_EXCEEDED` for the blocked ready retries. This keeps quota enforcement at new-attempt admission while retaining the existing owner/dependency diagnosis on other paths.

## Alternatives considered

**Create a generic scheduler service before a second implementation exists.** Rejected because the first scheduler has one concrete policy and no external Consumer needs a replaceable registry yet.

**Wake an Agent directly after assignment.** Rejected because an in-memory inbox call cannot recover an assignment committed before a process crash. The scheduler writes a durable channel Envelope; the Link and Agent Client own delivery and model input.

**Use an implicit interval for lease expiry.** Rejected because deployment timing belongs to an explicit pulse; a hidden timer complicates reload and does not survive process restart.

**Treat `team-scheduler/assigned` as the task outbox.** Rejected because it is a post-commit observation that can be lost or repeated. The task-assignment channel WAL is durable and replayable.

## Consequences

The scheduler owns deterministic lease selection, explicit expiry, review dispatch/response repair, and bounded stalled diagnosis. Agent/Link consumers own execution; workspace providers own artifact publication, and lifecycle owners prove quiescence and Team completion. The scheduler uses only the Team Service Definition and revalidates its operation-scoped authority at the provider.

The [durable task attempt lease decision](2026-08-28-durable-task-attempt-leases.md) remains the authority for task state, lease fencing, and replay validation. The [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) remains proposed because review/retry/stall policy, workspace allocation, remote Links, Goal/workflow convergence, and product entry points are unfinished.

## Verification

The real Hub review composition completes a second attempt after rework, obtains a distinct consult request, and accepts that second attempt while retaining both decisions. Busy-owner cases retain active work until an eligible worker becomes idle, preserve capability/workspace rejection, and dispose during the workspace eligibility wait without submitting another mutation. The runnable review-projection scenario independently exercises the actual worker's final model response overlapping rework.

Real Hub retention tests assign active work without requesting Team-journal compaction and create two direct channels with actual Envelopes, recipient receipts, and closure. Consecutive one-command drives must advance both retained WAL prefixes, and another drive must skip both. A separate Consumer test verifies channel maintenance precedes the terminal Team journal under the same budget.

Real Hub composition tests retain a running prerequisite and a delivered review request while a successor waits, then verify that a running reviewer does not stall the Team. Separate cases retain the missing-reviewer owner failure and a failed-prerequisite dependency deadlock. These cases use actual task assignment, settlement, activation status, and scheduler-owned proofs.

A separate real Hub test accumulates unassignable drives, starts an independent task, and settles it. The remaining unavailable work must then wait the full configured number of drives before stalling; progress resets the earlier count.

The [review terminal restart example](../../../../examples/headless-agent/tests/review-terminal-restart.snapshot.ts) drives a real worker report through participant review, consult delivery, and a running reviewer before failure or cancellation. JSON and SQLite runs kill the Host after durable terminal intent, then start another Loader. Recovery preserves the completed attempt and consult history, cancels the review task once, and stalls on the exact old activation epochs whose termination remains unconfirmed. Source and built-runtime runs exercise the same four scenarios.

Scheduler tests cover priority and creation ordering, capability specificity, load caps, idle activation selection, shared-scope conflicts, expiry-before-assignment, CAS rereads, policy-denial stop, startup scan, drive coalescing, channel/Envelope parser rejection, bounded wake recovery rotation and page continuation, advisory listener containment, no private timer, and bounded disposal. A real JSON-backed Hub composition confirms initial assignment dispatch and crash-window Envelope repair without duplicate WAL entries. The complete scheduler coverage check remains required after changes to these paths.

Budget-boundary JSON and SQLite tests mount the actual Hub and scheduler proof sources. They cover zero consumption/time, fractional cost below and at its limit, effective typed/legacy minima, positive concurrency waiting and release, empty versus pending zero-capacity Teams, zero-retry first attempts, the last admitted retry, later fresh tasks behind blocked retries, and final retry stalls. Direct Hub callers also retain the first-attempt exemption while rejecting exhausted typed or legacy retry quota. A capacity-wait regression preserves reset of earlier unassignable observations.

Clock-controlled Hub tests use `vi.spyOn(Date, 'now')`, without changing system time. Positive wall-time caps admit work just before the deadline and reject equality and later assignment, including a tighter legacy deadline. Zero wall time rejects public task creation before its Team journal cursor changes or any task/channel is created.

The [review-projection example](../../../../examples/headless-agent/tests/review-projection.snapshot.ts) also freezes `maxRetriesPerTeam: 1` for a rework scenario. Actual coordinator, worker, and reviewer Sessions complete the second attempt, accept its review, and deliver the final result while the Team retains that exact retry ceiling.
