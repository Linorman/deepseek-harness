# @clocky/clocky-team-scheduler-dag

English | [中文](README.zh.md)

`@clocky/clocky-team-scheduler-dag` is a local Team Consumer that deterministically proposes lease-backed assignments, writes their persistent task-assignment notification, expires overdue task attempts, and can run an explicitly configured terminal-stream retention drive through `ctx.teams`. It consults `ctx.teamWorkspaces` before selecting an owner but never allocates an execution root. It registers source-scoped ordinary-post proofs, and the Hub admits task-assignment and review-request Envelopes only while their leased task or review scope remains current. Its separate task-review proof repairs a closed consult response before retention can discard that response, even after the reviewer activation is offline; channel changes request the owning Team drive. A separate one-shot phase proof may mark only the current active Team stalled with the scheduler's exact budget or unassignable-work reason. It retains `TeamSystemTaskLeaseProof` only while assigning its exact selected task or expiring its exact elapsed attempt, and `TeamSystemSchedulerChannelProof` only while opening one selected review/wake channel, closing one unleased failed-assignment wake channel, or expiring one bounded channel batch with the drive's clock observation; the Hub revalidates both before durable acceptance. It owns neither generic Team authority nor Agent execution, and imports no Hub implementation, Agent, Session, or workspace provider implementation.

Team stall diagnosis waits while an assigned/running task attempt or an active reviewer's idle/running activation can make progress. These drives reset the unassignable-work count, including when pending successors depend on that work. Once no such work remains, an unavailable reviewer is an owner-eligibility failure; unsatisfied dependencies that cannot finish retain the dependency-deadlock diagnosis.

Ready pending work also waits for a running activation that satisfies its participant capabilities, load limit, permitted workspace mode, and current workspace-provider eligibility. That owner can become idle after finishing its current turn; unrelated busy participants and unavailable workspaces do not suppress stalled diagnosis. Disposal during the workspace check prevents a later phase or assignment command.

Wake-channel creation and recovery, and consult review posting, wait through `teamChannelAdmission.waitUntilActive()` before assignment or Envelope dispatch. The wait holds no Hub lock and stops with scheduler disposal. Missing endpoint consent is handled by the admission Consumer’s durable deadline; the scheduler never substitutes plugin registration for an acknowledgement.

## Scheduling and expiry

Each drive checks frozen consumption/time ceilings, expires due assigned or running leases, then selects ready `pending` tasks in descending priority and durable task-creation order. It considers only active `local-agent` and `remote-agent` participants that declare every required capability, have an exact `idle` activation, and hold fewer than `maxActiveAttemptsPerParticipant` active attempts. Before ranking those candidates, it calls `ctx.teamWorkspaces.eligible(task.workspaceMode, { task, binding })` and skips a `false` result; an unavailable provider rejects the drive. The scheduler never calls `allocate()`. It calls `assignTask()` with the task revision and configured `leaseDurationMs`; the Team provider remains the final authority for membership, capabilities, activation identity, task phase, revision, and lease validity. Discovery uses bounded `listTeamsPage()` calls with the configured `teamPageSize`; a pulse never requests the full Team collection.

Ranking requires the provider-frozen `rules.taskRanking` policy. Eligible candidates compare proposal, capability surplus, load, same-capability attempt outcome balance, median latency bucket, verified cost-rate bucket for a cost-constrained task, then Participant id. Missing history is neutral; unverified cost ranks last and never bypasses budget admission.

For each selected Agent lease, the scheduler opens exactly one self-assignee `task-assignment` channel with immutable `{ taskId, activationId, sessionId }` limits through a one-shot scheduler-channel proof. It supplies the resulting channel id to `assignTask()` so the Team provider attaches it to the new lease, then appends the channel's one self-addressed `assignment` Envelope with the minted attempt and assigned revision. If the proof or assignment rejects, it can close only that exact active wake channel after the Hub verifies no current lease references it; a close failure is reported with the assignment failure. Participant review uses the same proof family only to open its exact consult channel for the selected completed attempt and idle reviewer activation. A later drive recovers an interrupted assignment sequence from the attached channel and lease, appending the missing Envelope without creating another channel or Envelope for that lease.

For `shared` work, the scheduler skips a task when an assigned or running shared task reserves an overlapping declared `writeScopes` prefix; the workspace-root scope `.` overlaps every path. Every successful assignment and every compare-and-set conflict rereads the Team projection before selecting again, so load and shared-scope conflicts are recomputed from durable state. A task revision committed by the scheduler requests a follow-up coalesced drive even when the listener recognizes it as the scheduler's own mutation, so `maxAssignmentsPerDrive` remains a per-drive bound without leaving later ready tasks stranded. When a concurrent channel-maintenance CAS exhausts one drive's conflict budget, the coalesced drive retries the complete scan with a fresh projection before surfacing the race, keeping queued work eligible. `maxAssignmentsPerDrive`, `maxExpirationsPerDrive`, `maxWakeDispatchesPerDrive`, and `maxConflictsPerDrive` bound this work. Lease expiry calls `expireTaskAttempt()` with the recorded attempt fence; TTL-bound channel deliveries use one exact scheduler-channel proof per attached channel, carrying the drive's `scanNow`, both cursors, and remaining bound before task selection. Neither path fabricates an owner outcome.

Tasks compiled from a `TeamWorkflowPlan` remain dormant while the plan is `compiling`; once it reaches `ready`, the scheduler limits its assigned/running leases to the plan's `maxParallelism` and lets the Team provider enforce its `maxTotalAttempts`. A plan task without a current `ready` projection is never treated as unassignable work.

The optional `pulseIntervalMs` configuration installs a bounded recurring discovery pulse for lease expiry and retention; omitting it leaves scheduling event-driven for test or externally pulsed compositions. Retention is opt-in: configuring `terminalChannelRetentionTail` together with `maxCompactionsPerDrive` asks each drive to inspect terminal Teams and channels, then call the Hub's checkpoint-, audit-, and pending-delivery-gated compaction commands, retaining the configured source tail. A pending delivery or policy denial leaves the channel for a later drive. Its accepted `assignment` Envelope is durable owner notification, not a direct Agent wake: the scheduler does not write an Agent inbox, start an attempt, heartbeat a lease, or settle task work. A separate task Agent Consumer claims the exact delivery before starting the owner-fenced attempt and waking the Agent.

Each terminal Team-journal or channel-WAL compaction is wrapped in a one-shot scheduler maintenance proof bound to its exact cursor and `throughSequence`. The proof is revoked when that Hub call settles, so a scheduler-owned eligible prefix cannot be widened or replayed as a generic maintenance capability.

A retention drive visits terminal channels first and skips a prefix already removed according to the channel's `firstCursor`. If its compaction budget remains, it can then compact a completed, failed, or cancelled Team journal. This order lets a one-command budget advance across channels before journal maintenance. Closed channels remain eligible while their Team is active, stalled, or quiescing; those Team journals are outside terminal retention.

Review-channel lookup matches the dedicated review request's completed attempt id as well as its task and participants. A reworked task therefore receives a new consult request for its next completed attempt, while the earlier request, response, and decision remain in history.

The scheduler stops new scheduling when a frozen input/output/total-token, turn, cost, or wall-time allowance is reached. Typed count and time ceilings permit zero, and typed cost ceilings permit nonnegative fractions; matching positive-integer deployment limits remain effective, using the smaller valid ceiling.

Concurrency is an assignment capacity: expiry, wake repair, and review handling run before its check. A full positive `maxConcurrency` leaves accepted work active and resets earlier unassignable-work observations. Zero capacity stalls ready pending work explicitly, while an empty Team remains active. The Hub independently checks capacity before admitting each new lease.

A task's first attempt consumes no retry quota. Typed `maxRetries` and frozen `maxRetriesPerTeam` limit only later attempts, counting `sum(max(0, attemptCount - 1))` across retained tasks. Selection skips a blocked retry and continues to later first attempts. The last admitted retry can finish; `TEAM_RETRIES_BUDGET_EXCEEDED` is recorded only after leased/review work is absent and the remaining scheduler-ready tasks are all retries without quota. Other unsuccessful selection paths continue through the existing stall diagnosis.

## Configuration

`channelPageSize` bounds each scheduler review or task-assignment channel recovery page and defaults to `128`.

All configuration fields are required except the opt-in flags. `leaseDurationMs` is the duration requested for each assignment and must be accepted by the mounted Team provider. `maxAssignmentsPerDrive`, `maxExpirationsPerDrive`, `maxWakeDispatchesPerDrive`, and `maxConflictsPerDrive` bound assignments, task/channel expiry records, assignment-channel validation or publication, and compare-and-set conflict retries in one drive. `maxActiveAttemptsPerParticipant` limits leases that this scheduler may select for one participant. `permittedWorkspaceModes` lists task execution modes that this Consumer may select. `shared` is always required; `worktree`, `sandbox`, and `remote` additionally require `allowNonSharedWorkspaceModes: true` so deployments opt into providers that can supply isolated execution roots. `teamPageSize` bounds Team discovery work per source page. `stallAfterUnassignableDrives` controls how many drives with pending work but no eligible owner are required before the Team receives a durable stalled phase. `terminalChannelRetentionTail` and `maxCompactionsPerDrive` are an all-or-nothing opt-in pair: the first retains that many terminal Team or channel records, while the second bounds the number of compaction attempts per drive. `disposalTimeoutMs` bounds settlement of a drive that the plugin accepted before unload.

## Model Experience

### Team DAG scheduling

#### What the model sees

This package registers no prompt section, tool, model input, or model output. Its durable `task-assignment` Envelope reaches a model only when a separate Agent delivery Consumer admits the claimed delivery as a logged turn.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This package owns no model request prefix.

## Known Limitations and Deferred Work

- **Provider-owned allocation** — worktree, sandbox, and remote modes can be selected when explicitly enabled, while allocation, artifact provenance, and integration remain workspace-provider responsibilities.
- **No direct Agent wake or execution** — the persistent assignment channel is claimed by a separate Agent Consumer, which starts the exact owner-fenced attempt and admits the Agent inbox.
- **Coordinator-owned task admission** — Headless and Web mount this Consumer with the static shared-root provider and the default TeamRun coordinator's task tools; workers and ordinary Sessions cannot start or wait for default-worker tasks.
- **No final-answer completion policy** — this Consumer proposes bounded assignment, review dispatch, lease-expiry, and stalled transitions; The Hub owns usage accounting; TeamRun or another product policy owns final human-addressed completion. Owner reports can renew their lease through `team_task_heartbeat`.
