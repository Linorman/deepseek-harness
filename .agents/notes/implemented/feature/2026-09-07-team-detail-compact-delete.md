# Agent Note: Compact Team task details and authenticated deletion

Status: implemented

English | [中文](2026-09-07-team-detail-compact-delete.zh.md)

## Problem

The Team detail pane exposed identifiers, empty sections, repeated status text, and raw records before they were useful. It also lacked a browser action for deleting a lease-free task, and Web startup could expose the API gateway before the authenticated Team actor provider was ready.

## Decision

The [Team workspace decision](../architecture/2026-09-11-team-workspace-ui.md) owns task-summary and Team-module presentation. Lease-free task deletion requires explicit confirmation and removes the visible task only after the Host returns its deleted tombstone.

The Web API gateway waits for `teamHumanActors` before registering Team control methods. This makes the authenticated actor proof available before browser task deletion can run, while unauthenticated requests still receive the existing refusal. The shipped shared-workspace provider may resolve the durable Team workspace path, so worker Session `cwd` and scheduler eligibility use the folder the user selected instead of the Web process directory. Shipped profiles start with one worker; the coordinator can resize the durable pool to 32 through `team_worker_pool_set`, and concurrent ready tasks are assigned to distinct live Sessions while excess work remains queued instead of stalling. TeamRun serializes only pool topology and task admission, then reconciles idle excess workers after task pressure drops. The Team token budget is raised in shipped profiles and the local model patch exposes a 32,768-token request default.

Model-facing Team task tools now resolve scope declarations against the coordinator Agent's current workspace. Absolute paths inside that root become the strict Team wire form, the root itself becomes `.`, and paths outside the root fail with an actionable boundary message. The minimal preset keeps its two-tool surface while mounting the sandbox-enforcing filesystem and runtime permission context, so coordinator and worker models receive the active mode, workspace, and approval facts before they act.

The coordinator contract treats any non-trivial objective with multiple feasible workstreams as a command plan, whether the work is research, analysis, writing, planning, data, operations, coding, testing, or a mix. It requires at least two worker tasks before waiting, uses a declarative workflow for dependencies, leaves scopes empty for non-filesystem work, and recommends narrow, disjoint file scopes for shared-workspace writers. A read-only research, analysis, or review task fills the parallel slot when one worker must own a shared artifact, so a broad objective is not silently collapsed into one all-purpose worker.

The scheduler also retries a complete Team scan after a transient stale cursor in channel maintenance, using the existing conflict bound, so a queued task is not stranded by a concurrent receipt or worker-pool update.

Task detail ownership falls back to the latest settled attempt after a lease is released, and review status is attached to the configured reviewer participant. Completed work therefore keeps its worker attribution in the UI while active assignments remain tied to their current lease.

Team-owned coordinator and worker Agents now recover a provider `max-tokens` turn with a bounded continuation on the same Session. The continuation rechecks the live task lease and activation before waking a worker and asks the coordinator or worker to finish its pending Team tool operation; exhausting the worker bound settles its still-running attempt as a bounded failure, while exhausting the coordinator bound records the existing missing-final stall, instead of leaving a hidden infinite wait.

The Host model-catalog read path accepts a live Team worker Session for read-only metadata, while prompt and model mutation remain coordinator-owned. Opening a worker transcript therefore does not surface a false missing-coordinator error.

Team human-question authorization now treats the asking participant as a source identity: a worker or coordinator question is answered by the authenticated Team human owner, while a human-originated action still requires that exact human participant. Worker questions no longer fail with `not-pending` before their answer reaches the waiting Agent.

## Alternatives considered

Keep a fixed four-worker roster and rely on coordinator prompt wording alone. That leaves unused activations on small tasks and still gives the scheduler no explicit saturation result. A coordinator-only in-memory count would also disappear across restart. The selected design keeps a small initial roster, records every invited worker in the Team journal, bounds growth with `maxWorkerCount`, and reports queue pressure through the coordinator tool.

## Consequences

Task deletion and task stop remain revisioned and Host-owned. A failed or stale mutation keeps its confirmation dialog open with the returned error, and changing Teams aborts in-flight reads or mutations. Deleted tombstones remain durable but are omitted from the active task list. A Team-level cancel can fence a coordinator activation left running by a previous Host process, re-attach the product-owned run, and issue normal TeamRun cleanup, so a Host restart does not turn a valid stop into a missing-actor or still-running-activation error. The client polls after stop admission until the lease-free terminal projection is durable, so a transient `stopping` or stale `running` row does not hide the delete action.

## Testing

Client UI and runtime tests cover compact rendering, settled-attempt owner attribution, reviewer status, disclosure behavior, task stop/delete confirmation, abort handling, selected-state reconciliation, and body-level confirmation dialogs that preserve the source workspace. Workspace-provider and TeamRun tests cover a selected root, coordinator-driven worker-pool growth/shrink, multi-worker assignment fan-out with assignment messages reaching distinct Sessions, and automatic coordinator continuation after output truncation. Team Agent Client tests cover automatic worker continuation only for a still-running exact lease. Host API tests cover read-only model metadata for a worker Session, worker-originated human-question resolution, and coordinator-only mutation fences. Tool tests cover coordinator-only pool resize and saturation result, conversion of absolute in-workspace task and workflow scopes, root scopes, and rejection of outside paths. The keyless assembled Headless snapshot pins the coordinator's minimum-two-task delegation contract. The minimal preset snapshot verifies that its sandbox backend and runtime permission context are active. The shipped Web composition test deletes a lease-free task through an authenticated RPC after the real actor provider and API gateway have settled. Built Web boot and client package builds also pass.
